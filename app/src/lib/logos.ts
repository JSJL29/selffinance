// Logo officiel d'une banque, d'après la liste Enable Banking (module pur, testé dans tests/logos.test.ts).
// On n'affiche que les logos fournis par Enable Banking : aucun logo de marque n'est dessiné ni embarqué.

export type BankLogoEntry = { name: string; logo: string | null };

const words = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** « Caisse d'Épargne Île-de-France » → « caissedepargneiledefrance ». */
export function normalizeBank(name: string): string {
  return words(name).join('');
}

const MIN_PREFIX = 4; // « CE », « B »… : trop court pour deviner sans risque
// Seuls, ces mots désignent n'importe quelle banque : « Crédit » ne doit pas donner le logo du Crédit Agricole.
const GENERIC = new Set(['banque', 'bank', 'credit', 'caisse', 'societe', 'groupe', 'compte']);

type Indexed = { logo: string | null; norm: string; words: string[] };

/** `short` est formé des premiers mots entiers de `long` (« Fortuneo » ↔ « Fortuneo Banque »). */
function wordPrefix(short: string[], long: string[]): boolean {
  if (!short.length || short.length > long.length || short.join('').length < MIN_PREFIX) return false;
  if (short.length === 1 && GENERIC.has(short[0])) return false;
  return short.every((w, i) => w === long[i]);
}

function find(name: string, list: Indexed[], exact: Map<string, string | null>): string | null {
  if (exact.has(name)) return exact.get(name) ?? null;
  const w = words(name);
  const n = w.join('');
  if (!n) return null;
  const same = list.find((a) => a.norm === n);
  if (same) return same.logo;
  const prefix = list.find((a) => wordPrefix(w, a.words) || wordPrefix(a.words, w));
  return prefix?.logo ?? null;
}

/** Recherche préparée : la liste est normalisée une fois, les réponses sont gardées (listes longues). */
export function makeLogoLookup(aspsps: BankLogoEntry[]): (name: string) => string | null {
  const list = aspsps.map((a) => ({ logo: a.logo, words: words(a.name), norm: normalizeBank(a.name) }));
  const exact = new Map<string, string | null>();
  for (const a of aspsps) if (!exact.has(a.name)) exact.set(a.name, a.logo);
  const cache = new Map<string, string | null>();
  return (name) => {
    if (!cache.has(name)) cache.set(name, find(name, list, exact));
    return cache.get(name) ?? null;
  };
}

/** Exact, puis nom normalisé, puis premiers mots entiers communs ; null plutôt qu'un faux logo. */
export function logoFor(name: string, aspsps: BankLogoEntry[]): string | null {
  return makeLogoLookup(aspsps)(name);
}
