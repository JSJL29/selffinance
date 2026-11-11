// Synchro du compte IBKR via le Flex Web Service (lecture seule).
//   POST /ibkr/sync   secret Vault (cron 7 h) ou JWT app_user (bouton « Synchroniser IBKR »)
// Jeton : secret de fonction IBKR_FLEX_TOKEN, sinon Vault `ibkr_token`. ID de la Flex Query : Vault `ibkr_query_id`.
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseFlexResponse, parseStatement } from "./flex.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable ${k} manquante`);
  return v;
};
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const FLEX = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const UA = { "User-Agent": "selffinance/1.0" };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: UA });
  const body = await r.text();
  if (!r.ok) throw new Error(`IBKR HTTP ${r.status}`);
  return body;
}

/** SendRequest puis GetStatement, en attendant la génération du relevé (~1 min max). */
async function fetchStatement(token: string, queryId: string): Promise<string> {
  const t = encodeURIComponent(token);
  const send = parseFlexResponse(await get(`${FLEX}/SendRequest?t=${t}&q=${encodeURIComponent(queryId)}&v=3`));
  if (send.status !== "Success" || !send.referenceCode) {
    throw new Error(`IBKR SendRequest : ${send.errorCode ?? "?"} ${send.errorMessage ?? send.status ?? ""}`.trim());
  }
  for (let i = 0; i < 12; i++) {
    await sleep(i === 0 ? 2000 : 5000);
    const xml = await get(`${FLEX}/GetStatement?t=${t}&q=${send.referenceCode}&v=3`);
    if (xml.includes("<FlexQueryResponse")) return xml;
    const r = parseFlexResponse(xml);
    if (r.errorCode !== "1019") throw new Error(`IBKR GetStatement : ${r.errorCode ?? "?"} ${r.errorMessage ?? ""}`.trim());
  }
  throw new Error("IBKR : relevé toujours en cours de génération, réessaie dans quelques minutes.");
}

// ---------- Auth (mêmes règles que `quotes`) ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });

let syncSecret: string | null = null;
async function authorized(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!syncSecret) {
    const { data, error } = await db.rpc("sync_config").single();
    if (error || !data) throw new Error(`sync_config: ${error?.message ?? "vide"}`);
    syncSecret = (data as { sync_secret: string }).sync_secret;
  }
  if (auth === `Bearer ${syncSecret}`) return true;
  const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!u?.user) return false;
  const { data } = await db.from("app_users").select("user_id").eq("user_id", u.user.id).maybeSingle();
  return !!data;
}

// ---------- Synchro ----------
async function ibkrAccountId(): Promise<string> {
  const { data } = await db.from("manual_accounts").select("id").eq("sync_source", "ibkr").limit(1).maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await db.from("manual_accounts").insert({
    name: "CTO IBKR", institution: "IBKR", kind: "investment", envelope: "cto", currency: "EUR", sync_source: "ibkr",
  }).select("id").single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

async function sync() {
  const { data: cfg } = await db.rpc("ibkr_config").single();
  const queryId = (cfg as { query_id: string | null } | null)?.query_id;
  if (!queryId) throw new Error("ID de la Flex Query IBKR non configuré (Vault ibkr_query_id).");
  const token = Deno.env.get("IBKR_FLEX_TOKEN") || ((await db.rpc("ibkr_token")).data as string | null);
  if (!token) throw new Error("Jeton IBKR non configuré (secret IBKR_FLEX_TOKEN ou Vault ibkr_token).");

  const accountId = await ibkrAccountId();
  try {
    const st = parseStatement(await fetchStatement(token, queryId));
    const date = st.date ?? new Date().toISOString().slice(0, 10);

    // Titres (une ligne par conid IBKR)
    const symbols = st.positions.map((p) => `ibkr:${p.conid}`);
    const { data: known } = symbols.length
      ? await db.from("instruments").select("id, source_symbol").in("source_symbol", symbols)
      : { data: [] };
    const ids = new Map((known ?? []).map((k: { id: string; source_symbol: string }) => [k.source_symbol, k.id]));
    for (const p of st.positions) {
      const key = `ibkr:${p.conid}`;
      const fields = {
        name: p.name, isin: p.isin, type: p.type, currency: p.currency, price_source: "ibkr", source_symbol: key,
        last_price: Number.isFinite(p.markPrice) ? p.markPrice : null, last_price_date: date,
        price_updated_at: new Date().toISOString(), price_error: null,
      };
      if (ids.has(key)) {
        const { error } = await db.from("instruments").update(fields).eq("id", ids.get(key));
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await db.from("instruments").insert(fields).select("id").single();
        if (error) throw new Error(error.message);
        ids.set(key, data.id);
      }
      if (Number.isFinite(p.markPrice)) {
        await db.from("instrument_prices").upsert({ instrument_id: ids.get(key), date, price: p.markPrice });
      }
    }

    // Positions : IBKR fait foi, on remplace celles du compte.
    const { error: delErr } = await db.from("positions").delete().eq("account_id", accountId);
    if (delErr) throw new Error(delErr.message);
    if (st.positions.length) {
      const { error } = await db.from("positions").insert(st.positions.map((p) => ({
        account_id: accountId, instrument_id: ids.get(`ibkr:${p.conid}`), quantity: p.quantity,
        avg_cost: Number.isFinite(p.costBasisPrice) ? p.costBasisPrice : 0, cost_currency: p.currency,
      })));
      if (error) throw new Error(error.message);
    }

    // Ventes et dividendes (idempotent : une opération IBKR déjà vue n'est pas recréée).
    // Les liquidités IBKR viennent du relevé : cash_credit reste à 0.
    const { data: fx } = await db.from("fx_rates").select("currency, per_eur");
    const rate = new Map((fx ?? []).map((r: { currency: string; per_eur: number }) => [r.currency, Number(r.per_eur)]));
    // 1 EUR = x devise : taux du relevé (devise de base EUR), sinon taux du jour de la base.
    const fxPerEur = (currency: string, toBase: number | null) =>
      toBase ? 1 / toBase : currency === "EUR" ? 1 : rate.get(currency) ?? null;
    const instrumentFor = (conid: string | null) => (conid ? ids.get(`ibkr:${conid}`) ?? null : null);
    if (st.trades.length || st.cashTx.length) {
      // Titres vendus en totalité : absents des positions, on les retrouve par leur conid…
      const missing = [...new Set([...st.trades.map((t) => t.conid), ...st.cashTx.map((c) => c.conid ?? "")])]
        .filter((c) => c && !ids.has(`ibkr:${c}`)).map((c) => `ibkr:${c}`);
      if (missing.length) {
        const { data: more } = await db.from("instruments").select("id, source_symbol").in("source_symbol", missing);
        for (const m of more ?? []) ids.set(m.source_symbol, m.id);
      }
      // …ou on les crée à partir des infos de la vente (titre jamais vu en position).
      for (const t of st.trades) {
        const key = `ibkr:${t.conid}`;
        if (!t.conid || ids.has(key)) continue;
        const { data, error } = await db.from("instruments").insert({
          name: t.name || t.symbol, isin: t.isin, type: t.type, currency: t.currency, price_source: "ibkr", source_symbol: key,
        }).select("id").single();
        if (error) throw new Error(`instruments: ${error.message}`);
        ids.set(key, data.id);
      }
      const ops = [
        ...st.trades.map((t) => ({
          account_id: accountId, instrument_id: instrumentFor(t.conid), kind: "sell", date: t.date,
          quantity: t.quantity, price: t.price, fees: t.commission, currency: t.currency,
          realized: t.realized, fx_per_eur: fxPerEur(t.currency, t.fxRateToBase), source: "ibkr",
          external_id: `trade:${t.id}`, note: t.symbol || null,
        })),
        ...st.cashTx.map((c) => ({
          account_id: accountId, instrument_id: instrumentFor(c.conid), kind: c.type, date: c.date,
          amount: c.amount, currency: c.currency, fx_per_eur: fxPerEur(c.currency, c.fxRateToBase), source: "ibkr",
          external_id: `cash:${c.id}`, note: c.description || null,
        })),
      ].filter((o) => o.fx_per_eur != null); // devise sans taux connu : ignorée plutôt que comptée comme de l'euro
      const { error } = await db.from("operations")
        // defaultToNull: false → colonnes absentes d'une ligne = valeurs par défaut (fees 0, cash_credit 0…)
        .upsert(ops, { onConflict: "source,external_id", ignoreDuplicates: true, defaultToNull: false });
      if (error) throw new Error(`operations: ${error.message}`);
    }

    // Liquidités converties en EUR
    const missing = st.cash.filter((c) => !rate.has(c.currency)).map((c) => c.currency);
    const cashEur = st.cash.reduce((s, c) => s + (rate.has(c.currency) ? c.amount / rate.get(c.currency)! : 0), 0);

    await db.from("manual_accounts").update({
      cash_balance: Math.round(cashEur * 100) / 100, currency: "EUR", cash_updated_at: date,
      last_synced_at: new Date().toISOString(),
      sync_error: missing.length ? `Liquidités ignorées (taux de change absent) : ${missing.join(", ")}` : null,
    }).eq("id", accountId);

    return {
      ok: true, date, positions: st.positions.length, cash_eur: Math.round(cashEur * 100) / 100,
      sells: st.trades.length, dividends: st.cashTx.length,
    };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
    await db.from("manual_accounts").update({ sync_error: msg }).eq("id", accountId);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  try {
    if (!(await authorized(req))) return json({ ok: false, error: "Non connecté." }, 401);
    if (route === "sync" && req.method === "POST") return json(await sync());
    return json({ ok: false, error: "Route inconnue." }, 404);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
