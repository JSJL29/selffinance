// Choix d'une cotation Yahoo pour un titre IBKR (module pur, testé dans listing.test.ts).

/**
 * La première cotation dans la devise du titre (celle du PRU), sinon null.
 * Avec `symbol` (ticker IBKR, « BRK B » → « BRK-B ») : uniquement la cotation de ce symbole exact.
 */
export function pickListing(
  hits: { symbol: string; currency: string | null }[], currency: string, symbol?: string,
): string | null {
  const only = symbol?.trim().replace(/\s+/g, '-');
  return hits.find((h) => h.currency === currency && (!only || h.symbol === only))?.symbol ?? null;
}
