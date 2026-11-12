// Synchro du compte IBKR via le Flex Web Service (lecture seule).
//   POST /ibkr/sync   secret Vault (cron 7 h) ou JWT app_user (bouton « Synchroniser IBKR »)
// Jeton : secret de fonction IBKR_FLEX_TOKEN, sinon Vault `ibkr_token`. ID de la Flex Query : Vault `ibkr_query_id`.
// Facultatif : Vault `ibkr_confirm_query_id` = Trade Confirmation Flex Query (période « Aujourd'hui »), pour
// ajouter les ordres du jour au relevé de la veille.
import { createClient } from "npm:@supabase/supabase-js@2";
import { applyTodayTrades, parseConfirmations, parseFlexResponse, parseStatement, type TodayOp } from "./flex.ts";

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

    // Ordres du jour : ajoutés au relevé de la veille (facultatif ; un échec n'empêche pas la synchro).
    let today = 0;
    let todayOps: TodayOp[] = [];
    let todayError: string | null = null;
    const official = new Set(st.positions.map((p) => p.conid)); // lignes du relevé : cours de clôture fiables
    const confirmQuery = (await db.rpc("ibkr_confirm_query_id")).data as string | null;
    if (confirmQuery) {
      try {
        const merged = applyTodayTrades(st.positions, st.cash,
          parseConfirmations(await fetchStatement(token, confirmQuery)), date);
        st.positions = merged.positions;
        st.cash = merged.cash;
        today = merged.applied;
        todayOps = merged.ops;
      } catch (e) {
        todayError = `Ordres du jour non récupérés : ${e instanceof Error ? e.message : e}`;
      }
    }

    // Titres (une ligne par conid IBKR)
    const symbols = st.positions.map((p) => `ibkr:${p.conid}`);
    const { data: known } = symbols.length
      ? await db.from("instruments").select("id, source_symbol").in("source_symbol", symbols)
      : { data: [] };
    const ids = new Map((known ?? []).map((k: { id: string; source_symbol: string }) => [k.source_symbol, k.id]));
    for (const p of st.positions) {
      const key = `ibkr:${p.conid}`;
      const fields = {
        name: p.name, isin: p.isin, ticker: p.symbol || null, type: p.type, currency: p.currency,
        price_source: "ibkr", source_symbol: key, last_price: Number.isFinite(p.markPrice) ? p.markPrice : null, last_price_date: date,
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
      if (Number.isFinite(p.markPrice) && official.has(p.conid)) { // pas d'historique au prix d'un ordre du jour
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

    // Achats, ventes et dividendes (idempotent : une opération IBKR déjà vue n'est pas recréée).
    // Les liquidités IBKR viennent du relevé : cash_credit reste à 0.
    const { data: fx } = await db.from("fx_rates").select("currency, per_eur");
    const rate = new Map((fx ?? []).map((r: { currency: string; per_eur: number }) => [r.currency, Number(r.per_eur)]));
    // 1 EUR = x devise : taux du relevé (devise de base EUR), sinon taux du jour de la base.
    const fxPerEur = (currency: string, toBase: number | null) =>
      toBase ? 1 / toBase : currency === "EUR" ? 1 : rate.get(currency) ?? null;
    const instrumentFor = (conid: string | null) => (conid ? ids.get(`ibkr:${conid}`) ?? null : null);

    // Titres absents des positions (vendus en totalité) : retrouvés par leur conid, sinon créés depuis l'ordre.
    const traded = [...st.trades, ...todayOps];
    const missingIds = [...new Set([...traded.map((t) => t.conid), ...st.cashTx.map((c) => c.conid ?? "")])]
      .filter((c) => c && !ids.has(`ibkr:${c}`)).map((c) => `ibkr:${c}`);
    if (missingIds.length) {
      const { data: more } = await db.from("instruments").select("id, source_symbol").in("source_symbol", missingIds);
      for (const m of more ?? []) ids.set(m.source_symbol, m.id);
    }
    for (const t of traded) {
      const key = `ibkr:${t.conid}`;
      if (!t.conid || ids.has(key)) continue;
      const { data, error } = await db.from("instruments").insert({
        name: t.name || t.symbol, isin: t.isin, ticker: t.symbol || null, type: t.type, currency: t.currency,
        price_source: "ibkr", source_symbol: key,
      }).select("id").single();
      if (error) throw new Error(`instruments: ${error.message}`);
      ids.set(key, data.id);
    }

    // Le relevé contient les ordres jusqu'à sa date : il remplace les opérations provisoires de ces jours-là.
    if (st.hasTrades) {
      const { error } = await db.from("operations").delete()
        .eq("account_id", accountId).eq("source", "ibkr").eq("provisional", true).lte("date", date);
      if (error) throw new Error(`operations provisoires: ${error.message}`);
    }

    // Ordres du jour : provisoires, réécrits à chaque synchro (plus-value estimée au PRU moyen).
    if (todayOps.length) {
      const rows = todayOps.map((o) => ({
        account_id: accountId, instrument_id: instrumentFor(o.conid), kind: o.side === "BUY" ? "buy" : "sell",
        date: o.date, quantity: o.quantity, price: o.price, fees: o.commission, currency: o.currency,
        avg_cost: o.avgCost, realized: o.side === "SELL" ? o.realized : null, fx_per_eur: fxPerEur(o.currency, null),
        source: "ibkr", external_id: `trade:${o.id}`, provisional: true, note: o.symbol || null,
      })).filter((o) => o.fx_per_eur != null);
      const { error } = await db.from("operations")
        .upsert(rows, { onConflict: "source,external_id", defaultToNull: false });
      if (error) throw new Error(`operations du jour: ${error.message}`);
    }

    if (st.trades.length || st.cashTx.length) {
      const ops = [
        ...st.trades.map((t) => ({
          account_id: accountId, instrument_id: instrumentFor(t.conid), kind: t.side === "BUY" ? "buy" : "sell",
          date: t.date, quantity: t.quantity, price: t.price, fees: t.commission, currency: t.currency,
          realized: t.side === "SELL" ? t.realized : null, fx_per_eur: fxPerEur(t.currency, t.fxRateToBase),
          source: "ibkr", external_id: `trade:${t.id}`, note: t.symbol || null,
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
      sync_error: [missing.length ? `Liquidités ignorées (taux de change absent) : ${missing.join(", ")}` : null, todayError]
        .filter(Boolean).join(" · ") || null,
    }).eq("id", accountId);

    // Cours en direct (fonction `quotes`, Yahoo) : le relevé ne donne que la clôture de la veille.
    const held = [...new Set(st.positions.map((p) => ids.get(`ibkr:${p.conid}`)).filter(Boolean))];
    if (held.length) {
      await fetch(`${env("SUPABASE_URL")}/functions/v1/quotes/refresh`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${syncSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: held }),
      }).catch(() => undefined); // échec : on garde le cours IBKR
    }

    return {
      ok: true, date, positions: st.positions.length, cash_eur: Math.round(cashEur * 100) / 100,
      sells: st.trades.filter((t) => t.side === "SELL").length, dividends: st.cashTx.length, today,
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
