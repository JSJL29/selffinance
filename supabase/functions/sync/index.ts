// Synchronise soldes et transactions de tous les comptes liés via Enable Banking.
// Appelée par pg_cron (voir migration) avec `Authorization: Bearer <sync_secret Vault>`.
// Corps optionnel : { "days": 90 } pour forcer une reprise de l'historique.
import { createClient } from "npm:@supabase/supabase-js@2";

const EB = "https://api.enablebanking.com";
const FIRST_DAYS = 90; // premier import
const OVERLAP_DAYS = 7; // on recharge toujours la dernière semaine (opérations en cours)
const BALANCE_PREF = ["ITAV", "CLAV", "ITBD", "CLBD", "OPAV", "XPCD", "PRCD", "FWAV", "OTHR"];

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable ${k} manquante`);
  return v;
};

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// SYNC_SECRET et EB_APP_ID vivent dans Vault (voir migration sync_config).
// Seule la clé privée EB_PRIVATE_KEY est un secret de la fonction.
let config: { sync_secret: string; eb_app_id: string } | null = null;
async function getConfig() {
  if (!config) {
    const { data, error } = await db.rpc("sync_config").single();
    if (error || !data) throw new Error(`sync_config: ${error?.message ?? "vide"}`);
    config = data as { sync_secret: string; eb_app_id: string };
  }
  return config;
}

// ---------- JWT RS256 pour Enable Banking ----------
const enc = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function makeJwt(): Promise<string> {
  const pem = env("EB_PRIVATE_KEY").replace(/\\n/g, "\n");
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const input = `${part({ typ: "JWT", alg: "RS256", kid: (await getConfig()).eb_app_id })}.${
    part({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 })
  }`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input)));
  return `${input}.${b64url(sig)}`;
}

// deno-lint-ignore no-explicit-any
type Json = any;

async function eb(token: string, path: string): Promise<Json> {
  const r = await fetch(EB + path, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`EB ${path.split("?")[0]} -> ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ---------- Conversions ----------
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number, from = new Date()) => isoDay(new Date(from.getTime() - n * 86400_000));

function mapTx(t: Json) {
  const amt = Math.abs(Number(t.transaction_amount?.amount ?? 0));
  const debit = t.credit_debit_indicator === "DBIT";
  const who = debit ? t.creditor?.name : t.debtor?.name;
  const info = (t.remittance_information ?? []).join(" ").replace(/\s+/g, " ").trim();
  return {
    entry_reference: t.entry_reference ?? t.transaction_id ?? null,
    booking_date: t.booking_date ?? t.value_date ?? t.transaction_date ?? isoDay(new Date()),
    value_date: t.value_date ?? null,
    amount: debit ? -amt : amt,
    currency: t.transaction_amount?.currency ?? "EUR",
    counterparty: who ?? null,
    description: info || null,
    status: t.status ?? null,
    bank_code: t.bank_transaction_code?.code ?? null,
    raw: t,
  };
}

function pickBalance(list: Json[]) {
  const ok = (list ?? []).filter((b) => b.balance_amount?.currency && b.balance_amount.currency !== "XXX");
  ok.sort((a, b) => rank(a.balance_type) - rank(b.balance_type));
  return ok[0] ?? null;
}
const rank = (t: string) => {
  const i = BALANCE_PREF.indexOf(t);
  return i < 0 ? 99 : i;
};

const ACCOUNT_TYPES: Record<string, string> = {
  CACC: "Compte courant", SVGS: "Épargne", CARD: "Carte", LOAN: "Prêt",
};

// ---------- Synchro d'un compte ----------
async function syncAccount(token: string, acc: Json, forceDays: number | null) {
  const log: string[] = [];
  const patch: Json = {};

  let currency: string | null = acc.currency;
  if (!acc.iban && !acc.name) {
    const d = await eb(token, `/accounts/${acc.uid}/details`);
    currency = d.currency && d.currency !== "XXX" ? d.currency : null;
    Object.assign(patch, {
      name: d.product ?? d.details ?? ACCOUNT_TYPES[d.cash_account_type] ?? "Compte",
      iban: d.account_id?.iban ?? null,
      currency,
    });
  }

  const bal = pickBalance((await eb(token, `/accounts/${acc.uid}/balances`)).balances);
  if (bal) {
    Object.assign(patch, {
      balance: Number(bal.balance_amount.amount),
      balance_type: bal.balance_type,
      balance_at: new Date().toISOString(),
    });
    if (!currency) patch.currency = currency = bal.balance_amount.currency;
  } else {
    Object.assign(patch, { balance: null, balance_type: null });
  }

  let from: string;
  if (forceDays) from = daysAgo(forceDays);
  else {
    const { data: last } = await db.from("transactions").select("booking_date")
      .eq("account_uid", acc.uid).order("booking_date", { ascending: false }).limit(1);
    from = last?.length ? daysAgo(OVERLAP_DAYS, new Date(last[0].booking_date)) : daysAgo(FIRST_DAYS);
  }

  const txs: Json[] = [];
  let ck: string | null = null;
  do {
    const q: string = `/accounts/${acc.uid}/transactions?date_from=${from}` +
      (ck ? `&continuation_key=${encodeURIComponent(ck)}` : "");
    const r = await eb(token, q);
    txs.push(...(r.transactions ?? []));
    ck = r.continuation_key ?? null;
  } while (ck);

  const rows = txs.map(mapTx);
  if (!currency && rows.length) patch.currency = currency = rows[0].currency;
  const { data: n, error } = await db.rpc("replace_transactions", {
    p_account: acc.uid, p_from: from, p_rows: rows,
  });
  if (error) throw new Error(`replace_transactions: ${error.message}`);
  log.push(`${n} transaction(s) depuis le ${from}`);

  Object.assign(patch, { last_sync_at: new Date().toISOString(), last_error: null });
  const { error: e2 } = await db.from("accounts").update(patch).eq("uid", acc.uid);
  if (e2) throw new Error(`accounts: ${e2.message}`);
  return log.join(" ; ");
}

async function syncFx() {
  const r = await fetch("https://api.frankfurter.app/latest?from=EUR");
  if (!r.ok) throw new Error(`fx ${r.status}`);
  const { rates } = await r.json();
  const rows = Object.entries(rates as Record<string, number>)
    .map(([currency, per_eur]) => ({ currency, per_eur, updated_at: new Date().toISOString() }));
  const { error } = await db.from("fx_rates").upsert(rows);
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  const { sync_secret } = await getConfig();
  if (!sync_secret || req.headers.get("authorization") !== `Bearer ${sync_secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const forceDays = Number(body?.days) > 0 ? Number(body.days) : null;

  const { data: run } = await db.from("sync_runs").insert({}).select("id").single();
  const log: Record<string, string> = {};
  let ok = true;

  try { await syncFx(); log.fx = "ok"; } catch (e) { log.fx = String(e); }

  const { data: accounts, error } = await db.from("accounts")
    .select("uid, bank, name, iban, currency, hidden, bank_sessions(valid_until)");
  if (error) return new Response(error.message, { status: 500 });

  let token: string;
  try {
    token = await makeJwt();
  } catch (e) {
    log.jwt = String(e);
    if (run) await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, log }).eq("id", run.id);
    return Response.json({ ok: false, log }, { status: 500 });
  }
  await Promise.all((accounts ?? []).map(async (acc: Json) => {
    const key = `${acc.bank} ${acc.uid.slice(0, 8)}`;
    const until = acc.bank_sessions?.valid_until;
    if (until && new Date(until) < new Date()) {
      log[key] = "consentement expiré : reconnecter la banque";
      await db.from("accounts").update({ last_error: log[key] }).eq("uid", acc.uid);
      ok = false;
      return;
    }
    try {
      log[key] = await syncAccount(token, acc, forceDays);
    } catch (e) {
      ok = false;
      log[key] = String(e);
      await db.from("accounts").update({ last_error: String(e).slice(0, 500) }).eq("uid", acc.uid);
    }
  }));

  if (run) {
    await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok, log }).eq("id", run.id);
  }
  return Response.json({ ok, log });
});
