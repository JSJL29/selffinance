// Cours des titres du Patrimoine (n'utilise ni Enable Banking ni le budget de synchro).
//   GET  /quotes/search?q=<ISIN | nom>   (JWT app_user ou secret) → { ok, results: SearchResult[] }
//   POST /quotes/refresh { ids?: string[] }
//        JWT app_user : met à jour les titres `ids` ; secret Vault (cron) : tous les titres automatiques.
// Les sources de cours sont derrière l'interface PriceProvider : on peut remplacer Yahoo
// (API non officielle) par un fournisseur payant sans toucher au reste.
import { createClient } from "npm:@supabase/supabase-js@2";
import { pickListing } from "./listing.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable ${k} manquante`);
  return v;
};
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

type InstrumentType = "stock" | "etf" | "fund" | "fcpe" | "fonds_euros" | "bond" | "crypto" | "other";
type Source = "yahoo" | "amf";
export type SearchResult = {
  name: string;
  isin: string | null;
  symbol: string;
  exchange: string;
  currency: string | null;
  type: InstrumentType;
  source: Source;
};
type Quote = { price: number; date: string; currency: string };
type PriceProvider = {
  search(q: string): Promise<SearchResult[]>;
  quote(symbol: string): Promise<Quote>;
};

// ---------- Yahoo Finance ----------
const YAHOO = "https://query2.finance.yahoo.com";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; selffinance/1.0)" };
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const YAHOO_TYPES: Record<string, InstrumentType> = {
  EQUITY: "stock", ETF: "etf", MUTUALFUND: "fund", CRYPTOCURRENCY: "crypto",
};
const EXCHANGE_RANK = ["PAR", "AMS", "GER", "MIL", "BRU", "EBS", "LSE"];

// deno-lint-ignore no-explicit-any
type Json = any;

async function yahooJson(path: string): Promise<Json> {
  const r = await fetch(YAHOO + path, { headers: UA });
  if (!r.ok) throw new Error(`Yahoo ${path.split("?")[0]} -> ${r.status}`);
  return r.json();
}

async function yahooSearchRaw(q: string): Promise<Json[]> {
  const r = await yahooJson(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`);
  return (r.quotes ?? []).filter((x: Json) => x.symbol && YAHOO_TYPES[x.quoteType]);
}

const yahoo: PriceProvider = {
  async search(q) {
    const isin = ISIN_RE.test(q.trim().toUpperCase()) ? q.trim().toUpperCase() : null;
    let hits = await yahooSearchRaw(q);
    // Un ISIN ne renvoie souvent qu'une cotation : on cherche les autres places par le nom complet.
    if (isin && hits[0]?.longname) {
      const name = hits[0].longname;
      const more = (await yahooSearchRaw(name)).filter((x: Json) => x.longname === name);
      const seen = new Set(hits.map((h: Json) => h.symbol));
      hits = [...hits, ...more.filter((m: Json) => !seen.has(m.symbol))];
    }
    hits = hits.slice(0, 8);
    // La recherche ne donne pas la devise : on la lit sur chaque cotation.
    const currencies = await Promise.all(hits.map((h: Json) => this.quote(h.symbol).then((x) => x.currency, () => null)));
    const results: SearchResult[] = hits.map((h: Json, i: number) => ({
      name: h.longname ?? h.shortname ?? h.symbol,
      isin,
      symbol: h.symbol,
      exchange: h.exchDisp ?? h.exchange ?? "",
      currency: currencies[i],
      type: YAHOO_TYPES[h.quoteType] ?? "other",
      source: "yahoo",
    }));
    const rank = (r: SearchResult, raw: Json) => {
      const ex = EXCHANGE_RANK.indexOf(raw.exchange);
      return (r.currency === "EUR" ? 0 : 100) + (ex < 0 ? 50 : ex);
    };
    return results
      .map((r, i) => ({ r, k: rank(r, hits[i]), i }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .map((x) => x.r);
  },

  async quote(symbol) {
    const r = await yahooJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`);
    const meta = r.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") throw new Error(`Yahoo : pas de cours pour ${symbol}`);
    let price = meta.regularMarketPrice as number;
    let currency = String(meta.currency ?? "EUR");
    if (currency === "GBp" || currency === "GBX") { price = price / 100; currency = "GBP"; } // pence
    const date = new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
    return { price, date, currency };
  },
};

// ---------- AMF (FCPE) ----------
// Pas de source publique exploitable simplement pour l'instant (voir docs/open-banking.md) :
// les FCPE se saisissent à la main. Le fournisseur existe pour garder l'interface.
const amf: PriceProvider = {
  search: () => Promise.resolve([]),
  quote: (code) => Promise.reject(new Error(`AMF : récupération automatique indisponible (${code})`)),
};

const providers: Record<Source, PriceProvider> = { yahoo, amf };

// ---------- HTTP ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const fail = (status: number, error: string) => json({ ok: false, error }, status);

let syncSecret: string | null = null;
async function isCron(req: Request) {
  if (!syncSecret) {
    const { data, error } = await db.rpc("sync_config").single();
    if (error || !data) throw new Error(`sync_config: ${error?.message ?? "vide"}`);
    syncSecret = (data as { sync_secret: string }).sync_secret;
  }
  return req.headers.get("authorization") === `Bearer ${syncSecret}`;
}

async function isAppUser(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return false;
  const { data } = await db.from("app_users").select("user_id").eq("user_id", u.user.id).maybeSingle();
  return !!data;
}

/**
 * Titre IBKR : cours Yahoo en direct (le relevé IBKR ne donne que la clôture de la veille).
 * Cotation trouvée par ISIN dans la devise du PRU, retenue dans `quote_symbol`. Introuvable :
 * on garde le cours IBKR, sans erreur affichée.
 */
async function refreshIbkr(i: Json): Promise<boolean> {
  let symbol: string | null = i.quote_symbol;
  if (!symbol) {
    if (i.isin) symbol = pickListing(await yahoo.search(i.isin), i.currency);
    // ISIN inconnu de Yahoo (ex. Alphabet) : ticker IBKR, seulement si Yahoo a ce symbole exact.
    if (!symbol && i.ticker) symbol = pickListing(await yahoo.search(i.ticker), i.currency, i.ticker);
    if (!symbol) return false;
    await db.from("instruments").update({ quote_symbol: symbol }).eq("id", i.id);
  }
  const qt = await yahoo.quote(symbol);
  if (qt.currency !== i.currency) return false; // jamais un cours dans une autre devise que le PRU
  const { error } = await db.from("instruments").update({
    last_price: qt.price, last_price_date: qt.date, price_updated_at: new Date().toISOString(),
  }).eq("id", i.id);
  if (error) throw new Error(error.message);
  await db.from("instrument_prices").upsert({ instrument_id: i.id, date: qt.date, price: qt.price });
  return true;
}

async function refresh(ids: string[] | null) {
  let q = db.from("instruments").select("id, price_source, source_symbol, quote_symbol, ticker, isin, currency")
    .in("price_source", ["yahoo", "amf", "ibkr"]);
  if (ids) q = q.in("id", ids);
  const { data: list, error } = await q;
  if (error) throw new Error(error.message);

  const errors: Record<string, string> = {};
  let updated = 0;
  await Promise.all((list ?? []).map(async (i: Json) => {
    if (i.price_source === "ibkr") {
      if (await refreshIbkr(i).catch(() => false)) updated++;
      return;
    }
    try {
      if (!i.source_symbol) throw new Error("symbole manquant");
      const qt = await providers[i.price_source as Source].quote(i.source_symbol);
      const { error: e1 } = await db.from("instruments").update({
        last_price: qt.price, last_price_date: qt.date, currency: qt.currency,
        price_updated_at: new Date().toISOString(), price_error: null,
      }).eq("id", i.id);
      if (e1) throw new Error(e1.message);
      await db.from("instrument_prices").upsert({ instrument_id: i.id, date: qt.date, price: qt.price });
      updated++;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      errors[i.id] = msg;
      await db.from("instruments").update({ price_error: msg, price_updated_at: new Date().toISOString() }).eq("id", i.id);
    }
  }));
  return { ok: Object.keys(errors).length === 0, updated, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  try {
    const cron = await isCron(req);
    if (!cron && !(await isAppUser(req))) return fail(401, "Non connecté.");

    if (route === "search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2) return json({ ok: true, results: [] });
      const lists = await Promise.all(Object.values(providers).map((p) => p.search(q).catch(() => [])));
      return json({ ok: true, results: lists.flat() });
    }
    if (route === "refresh" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : null;
      if (!cron && !ids?.length) return fail(400, "ids requis.");
      return json(await refresh(ids));
    }
    return fail(404, "Route inconnue.");
  } catch (e) {
    console.error(e);
    return fail(500, String(e instanceof Error ? e.message : e));
  }
});
