// Synchronise soldes et transactions de tous les comptes liés via Enable Banking.
// Appelée par pg_cron aux heures choisies dans l'app (run_scheduled_sync) avec
// `Authorization: Bearer <sync_secret Vault>`, ou par l'app (bouton « Synchroniser »)
// avec le JWT de l'utilisateur, dans la limite du budget du jour (sync_budget).
// Corps optionnel (cron seulement) : { "days": 90 } pour forcer une reprise de l'historique.
import { createClient } from "npm:@supabase/supabase-js@2";
import { daysBefore, periodLimitDays, syncFrom } from "./period.ts";

const EB = "https://api.enablebanking.com";
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

  let lastBooking: string | null = null;
  if (!forceDays) {
    const { data: last } = await db.from("transactions").select("booking_date")
      .eq("account_uid", acc.uid).order("booking_date", { ascending: false }).limit(1);
    lastBooking = last?.[0]?.booking_date ?? null;
  }
  let from = syncFrom(new Date(), lastBooking, forceDays);

  const fetchTxs = async (since: string) => {
    const out: Json[] = [];
    let ck: string | null = null;
    do {
      const q: string = `/accounts/${acc.uid}/transactions?date_from=${since}` +
        (ck ? `&continuation_key=${encodeURIComponent(ck)}` : "");
      const r = await eb(token, q);
      out.push(...(r.transactions ?? []));
      ck = r.continuation_key ?? null;
    } while (ck);
    return out;
  };
  let txs: Json[];
  try {
    txs = await fetchTxs(from);
  } catch (e) {
    // Période refusée par la banque (ex. Caisse d'Épargne : 62 jours) : un seul nouvel essai dans sa limite.
    const limit = periodLimitDays(String(e));
    if (!limit) throw e;
    from = daysBefore(limit - 1, new Date());
    txs = await fetchTxs(from);
  }

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

// Budget : 4 accès/jour (DSP2) = synchros auto (sync_settings) + manuelles (voir sync_budget).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers: CORS });

// Cron (secret Vault) ou app (JWT d'un app_user, quota journalier).
async function authorize(req: Request): Promise<"cron" | "manual" | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const { sync_secret } = await getConfig();
  if (sync_secret && auth === `Bearer ${sync_secret}`) return "cron";

  const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!u?.user) return fail(401, "Non connecté.");
  const { data: member } = await db.from("app_users").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!member) return fail(403, "Accès refusé.");

  const { data: budget, error } = await db.rpc("sync_budget").single();
  if (error) return fail(500, error.message);
  if (((budget as { manual_left: number } | null)?.manual_left ?? 0) <= 0) {
    return fail(429, "Plus de synchro manuelle disponible aujourd'hui (limite bancaire : 4 accès par jour, synchros automatiques comprises).");
  }
  const { data: running } = await db.from("sync_runs").select("id")
    .is("finished_at", null).gte("started_at", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1);
  if (running?.length) return fail(409, "Une synchro est déjà en cours.");
  return "manual";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const trigger = await authorize(req);
  if (trigger instanceof Response) return trigger;

  const body = await req.json().catch(() => ({}));
  // Options réservées aux appels serveur (secret) : reprise d'historique, et synchro
  // initiale d'une banque juste connectée (`only` + trigger « connect », hors budget).
  const server = trigger === "cron";
  const forceDays = server && Number(body?.days) > 0 ? Number(body.days) : null;
  const only: string[] | null = server && Array.isArray(body?.only) ? body.only.map(String) : null;
  const runTrigger = server && body?.trigger === "connect" ? "connect" : trigger;

  const { data: run } = await db.from("sync_runs").insert({ trigger: runTrigger }).select("id").single();
  const log: Record<string, string> = {};
  let ok = true;

  try { await syncFx(); log.fx = "ok"; } catch (e) { log.fx = String(e); }

  let query = db.from("accounts").select("uid, bank, name, iban, currency, hidden, bank_sessions(valid_until)");
  if (only) query = query.in("uid", only);
  const { data: accounts, error } = await query;
  if (error) {
    // On clôt la synchro, sinon elle reste « en cours » et bloque le bouton quelques minutes.
    log.accounts = error.message;
    if (run) await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, log }).eq("id", run.id);
    return fail(500, error.message);
  }

  let token: string;
  try {
    token = await makeJwt();
  } catch (e) {
    log.jwt = String(e);
    if (run) await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, log }).eq("id", run.id);
    return Response.json({ ok: false, error: "Clé Enable Banking invalide ou absente.", log }, { status: 500, headers: CORS });
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
  return Response.json({ ok, log }, { headers: CORS });
});
