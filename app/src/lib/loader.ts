// Logo « SF » qui se trace pendant les chargements (module pur, testé dans tests/loader.test.ts).
// Mêmes tracés que scripts/make-icons.mjs ; le S est parcouru à l'envers, du bas vers la barre du haut.

/** S du bas vers le haut : barre du bas, deux demi-cercles (rayon 6), barre du haut jusqu'au point. */
export const S_PATH = 'M11 44 H22.5 a6 6 0 0 0 0 -12 h-4 a6 6 0 0 1 0 -12 H48';
/** F : la hampe, puis la barre du milieu (la barre du haut est celle du S). */
export const F_PATH = 'M37 20 V44 M37 32 H45';
export const S_LEN = 11.5 + 6 * Math.PI + 4 + 6 * Math.PI + 29.5;
export const F_LEN = 24 + 8;

/** Rayon du point violet au bout de la barre du haut. */
const DOT_R = 4;
/** Le point grandit pendant les 3 dernières unités du S. */
const DOT_GROW = 3;

export const RETRY_SECONDS = 5;
/** Hors connexion, le tracé reste figé à mi-chemin. */
export const OFFLINE_PROGRESS = 0.55;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Décalages de tirets du S et du F, et rayon du point, pour un avancement p ∈ [0, 1] (borné). */
export function drawState(p: number): { sOffset: number; fOffset: number; dotR: number } {
  const x = clamp01(p) * (S_LEN + F_LEN);
  const s = Math.min(x, S_LEN);
  const f = clamp01(p) === 1 ? F_LEN : Math.min(F_LEN, Math.max(0, x - S_LEN));
  return { sOffset: S_LEN - s, fOffset: F_LEN - f, dotR: DOT_R * clamp01((s - (S_LEN - DOT_GROW)) / DOT_GROW) };
}

const CYCLE = 2.2;
const DRAW = 1.4;
const FADE_FROM = 1.8;

/** Instant t (secondes) d'une boucle de 2,2 s : tracé 0 → 1,4 s (accéléré puis freiné), plein, puis fondu dès 1,8 s. */
export function cycle(t: number): { progress: number; opacity: number } {
  const u = ((t % CYCLE) + CYCLE) % CYCLE;
  const progress = u < DRAW ? (1 - Math.cos((Math.PI * u) / DRAW)) / 2 : 1;
  const opacity = u < FADE_FROM ? 1 : 1 - (u - FADE_FROM) / (CYCLE - FADE_FROM);
  return { progress, opacity };
}

/** Message d'une coupure réseau (fetch React Native, navigateur, Node) — pas une erreur du serveur. */
export function isNetworkError(message: string | null): boolean {
  return !!message && /network ?request failed|failed to fetch|networkerror|fetch failed|timed out|timeout/i.test(message);
}
