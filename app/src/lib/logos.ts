// Logo officiel d'une banque, d'après la liste Enable Banking (module pur, testé dans tests/logos.test.ts).
// On n'affiche que les logos fournis par Enable Banking : aucun logo de marque n'est dessiné ni embarqué.

export type BankLogoEntry = { name: string; logo: string | null };

/** « Caisse d'Épargne Île-de-France » → « caissedepargneiledefrance ». */
export function normalizeBank(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MIN_PREFIX = 4; // « CE », « B »… : trop court pour deviner sans risque

/** Nom exact, puis nom normalisé, puis l'un commence par l'autre (« Fortuneo » ↔ « Fortuneo Banque »). */
export function logoFor(name: string, aspsps: BankLogoEntry[]): string | null {
  const exact = aspsps.find((a) => a.name === name);
  if (exact) return exact.logo;
  const n = normalizeBank(name);
  if (!n) return null;
  const same = aspsps.find((a) => normalizeBank(a.name) === n);
  if (same) return same.logo;
  const prefix = aspsps.find((a) => {
    const m = normalizeBank(a.name);
    const [short, long] = m.length < n.length ? [m, n] : [n, m];
    return short.length >= MIN_PREFIX && long.startsWith(short);
  });
  return prefix?.logo ?? null;
}
