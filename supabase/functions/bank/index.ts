// Connexion / reconnexion d'une banque depuis l'app, via Enable Banking.
//   GET  /bank/aspsps?country=FR   (JWT app_user) liste des banques disponibles
//   POST /bank/start               (JWT app_user) { bank, country, return_to } -> { url, state }
//   GET  /bank/callback            (redirection Enable Banking) -> renvoie vers l'app
//   GET  /bank/status?state=…      (JWT app_user) résultat de la connexion
// L'URL de /bank/callback doit figurer dans les « Allowed redirect URLs » de l'app
// Enable Banking (Control Panel).
import { createClient } from "npm:@supabase/supabase-js@2";

const EB = "https://api.enablebanking.com";
const MAX_CONSENT_DAYS = 180;
const REQUEST_TTL_MIN = 30; // durée de vie d'une demande de connexion

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variable ${k} manquante`);
  return v;
};

const SUPABASE_URL = env("SUPABASE_URL");
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/bank/callback`;
const db = createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// ---------- Config (Vault) + JWT Enable Banking : mêmes règles que `sync` ----------
let config: { sync_secret: string; eb_app_id: string } | null = null;
async function getConfig() {
  if (!config) {
    const { data, error } = await db.rpc("sync_config").single();
    if (error || !data) throw new Error(`sync_config: ${error?.message ?? "vide"}`);
    config = data as { sync_secret: string; eb_app_id: string };
  }
  return config;
}

const enc = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function makeJwt(): Promise<string> {
  const pem = env("EB_PRIVATE_KEY").replace(/\\n/g, "\n");
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
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

async function eb(method: "GET" | "POST", path: string, body?: unknown): Promise<Json> {
  const r = await fetch(EB + path, {
    method,
    headers: { Authorization: `Bearer ${await makeJwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`EB ${method} ${path.split("?")[0]} -> ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ---------- HTTP ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const fail = (status: number, error: string) => json({ ok: false, error }, status);

async function requireAppUser(req: Request): Promise<string | Response> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return fail(401, "Non connecté.");
  const { data: member } = await db.from("app_users").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!member) return fail(403, "Accès refusé.");
  return u.user.id;
}

// Retour vers l'app : schéma de l'app (build) ou Expo Go (dev) uniquement.
const isAppUrl = (u: string) => /^(selffinance|exps?):\/\//i.test(u);

function backToApp(returnTo: string, params: Record<string, string>) {
  const url = returnTo + (returnTo.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: url } });
}

// ---------- Banques disponibles ----------
type Aspsp = { name: string; country: string; logo: string | null; max_days: number };
const aspspCache = new Map<string, { at: number; list: Aspsp[] }>();

async function listAspsps(country: string): Promise<Aspsp[]> {
  const hit = aspspCache.get(country);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.list;
  const r = await eb("GET", `/aspsps?country=${encodeURIComponent(country)}`);
  const list: Aspsp[] = (r.aspsps ?? [])
    .filter((a: Json) => !a.psu_types || a.psu_types.includes("personal"))
    .map((a: Json) => ({
      name: a.name,
      country: a.country,
      logo: a.logo ?? null,
      max_days: Math.round((a.maximum_consent_validity ?? 90 * 86400) / 86400),
    }))
    .sort((a: Aspsp, b: Aspsp) => a.name.localeCompare(b.name, "fr"));
  aspspCache.set(country, { at: Date.now(), list });
  return list;
}

// ---------- Démarrage ----------
async function start(req: Request, userId: string) {
  const body = await req.json().catch(() => ({}));
  const bank = String(body?.bank ?? "");
  const country = String(body?.country ?? "FR");
  const returnTo = String(body?.return_to ?? "");
  if (!bank) return fail(400, "Banque manquante.");
  if (!isAppUrl(returnTo)) return fail(400, "Adresse de retour invalide.");

  const aspsp = (await listAspsps(country)).find((a) => a.name === bank);
  if (!aspsp) return fail(404, `Banque « ${bank} » introuvable (${country}).`);

  const days = Math.min(aspsp.max_days, MAX_CONSENT_DAYS);
  const validUntil = new Date(Date.now() + days * 86400_000 - 60_000).toISOString();
  const state = crypto.randomUUID();

  const { error } = await db.from("bank_auth_requests")
    .insert({ state, bank, country, return_to: returnTo, user_id: userId });
  if (error) return fail(500, error.message);

  const r = await eb("POST", "/auth", {
    access: { valid_until: validUntil },
    aspsp: { name: bank, country },
    state,
    redirect_url: CALLBACK_URL,
    psu_type: "personal",
  });
  return json({ ok: true, url: r.url, state });
}

// ---------- Résultat d'une connexion (relu par l'app) ----------
async function status(url: URL, userId: string) {
  const state = url.searchParams.get("state") ?? "";
  const { data } = await db.from("bank_auth_requests")
    .select("result, consumed_at").eq("state", state).eq("user_id", userId).maybeSingle();
  if (!data) return fail(404, "Demande inconnue.");
  return json({ ok: true, result: data.result ?? { status: data.consumed_at ? "processing" : "pending" } });
}

// ---------- Retour de la banque ----------
const ACCOUNT_TYPES: Record<string, string> = {
  CACC: "Compte courant", SVGS: "Épargne", CARD: "Carte", LOAN: "Prêt",
};

async function callback(url: URL) {
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const ebError = url.searchParams.get("error");

  const since = new Date(Date.now() - REQUEST_TTL_MIN * 60_000).toISOString();
  const { data: request } = await db.from("bank_auth_requests")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state).is("consumed_at", null).gte("created_at", since)
    .select("bank, country, return_to").maybeSingle();
  if (!request) {
    return new Response("Lien de connexion expiré ou déjà utilisé. Recommence depuis l'app.", { status: 400 });
  }
  // Enregistre le résultat (relu par l'app) puis renvoie vers l'app.
  const back = async (p: Record<string, string>) => {
    await db.from("bank_auth_requests").update({ result: p }).eq("state", state);
    return backToApp(request.return_to, { bank: request.bank, ...p });
  };

  if (ebError || !code) {
    const msg = url.searchParams.get("error_description") ?? ebError ?? "connexion annulée";
    console.error("connexion refusée", request.bank, msg);
    return await back({ status: "error", message: msg });
  }

  try {
    const s = await eb("POST", "/sessions", { code });
    const accounts = (s.accounts ?? []).map((a: Json) => ({
      uid: a.uid,
      iban: a.account_id?.iban ?? null,
      currency: a.currency && a.currency !== "XXX" ? a.currency : null,
      name: a.product ?? a.name ?? a.details ?? ACCOUNT_TYPES[a.cash_account_type] ?? null,
    }));
    console.log("session", request.bank, `${accounts.length} compte(s)`);
    if (!accounts.length) {
      return await back({
        status: "error",
        message: `${request.bank} n'a partagé aucun compte. En usage personnel, Enable Banking ne donne accès qu'aux ` +
          `comptes aussi liés dans son Control Panel : lie d'abord ${request.bank} là-bas, puis réessaie ` +
          `en cochant les mêmes comptes.`,
      });
    }
    const { data: fresh, error } = await db.rpc("adopt_bank_session", {
      p: {
        session_id: s.session_id,
        bank: s.aspsp?.name ?? request.bank,
        country: s.aspsp?.country ?? request.country,
        valid_until: s.access?.valid_until,
        accounts,
      },
    });
    if (error) throw new Error(error.message);

    // Nouvelle banque : on récupère tout de suite son historique (hors budget, l'utilisateur est présent).
    const newUids = (fresh ?? []) as string[];
    if (newUids.length) {
      const { sync_secret } = await getConfig();
      const job = fetch(`${SUPABASE_URL}/functions/v1/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sync_secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ only: newUids, days: 90, trigger: "connect" }),
      }).catch((e) => console.error("synchro initiale", e));
      // @ts-ignore EdgeRuntime est fourni par Supabase
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job);
    }

    return await back({ status: "ok", accounts: String(accounts.length), new: String(newUids.length) });
  } catch (e) {
    console.error(e);
    return await back({ status: "error", message: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    if (route === "callback" && req.method === "GET") return await callback(url);

    const user = await requireAppUser(req);
    if (user instanceof Response) return user;

    if (route === "aspsps") {
      const country = url.searchParams.get("country") ?? "FR";
      return json({ ok: true, aspsps: await listAspsps(country) });
    }
    if (route === "start" && req.method === "POST") return await start(req, user);
    if (route === "status") return await status(url, user);
    return fail(404, "Route inconnue.");
  } catch (e) {
    console.error(e);
    return fail(500, String(e instanceof Error ? e.message : e));
  }
});
