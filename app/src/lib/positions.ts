// Règles pures sur les positions (testées dans tests/positions.test.ts).

type PriceState = { price_source: 'yahoo' | 'amf' | 'manual'; last_price: number | null; price_error: string | null };

/** On peut saisir la valeur à la main pour un titre manuel, ou un titre coté dont le cours est introuvable. */
export function canEditPrice(p: PriceState): boolean {
  return p.price_source === 'manual' || p.last_price == null || !!p.price_error;
}

/**
 * Solde d'un compte manuel, virements depuis la dernière saisie compris (au centime).
 * Taux de change manquant (`transfers` null) : solde saisi seul, l'écran signale le manque.
 */
export function currentCash(a: { cash_balance: number; transfers: number | null }): number {
  return Math.round((a.cash_balance + (a.transfers ?? 0)) * 100) / 100;
}

/**
 * Point de départ des virements à l'enregistrement du formulaire : aujourd'hui (le solde saisi les inclut),
 * sauf si leur somme est inconnue (taux manquant) : on garde l'ancien, sinon ils seraient perdus.
 */
export function transfersFromOnSave(
  a: { transfers: number | null; transfers_from: string } | null, today: string,
): string {
  return a && a.transfers == null ? a.transfers_from : today;
}

type Lot = { quantity: number; avg_cost: number };

/** Ajoute un achat à une position existante : quantités additionnées, PRU moyen pondéré (4 décimales). */
export function mergePosition(current: Lot, added: Lot): Lot {
  const quantity = current.quantity + added.quantity;
  if (quantity <= 0) return { ...added };
  const cost = current.quantity * current.avg_cost + added.quantity * added.avg_cost;
  return { quantity, avg_cost: Math.round((cost / quantity) * 10000) / 10000 };
}
