// Règles pures sur les positions (testées dans tests/positions.test.ts).

type PriceState = { price_source: 'yahoo' | 'amf' | 'manual'; last_price: number | null; price_error: string | null };

/** On peut saisir la valeur à la main pour un titre manuel, ou un titre coté dont le cours est introuvable. */
export function canEditPrice(p: PriceState): boolean {
  return p.price_source === 'manual' || p.last_price == null || !!p.price_error;
}

type Lot = { quantity: number; avg_cost: number };

/** Ajoute un achat à une position existante : quantités additionnées, PRU moyen pondéré (4 décimales). */
export function mergePosition(current: Lot, added: Lot): Lot {
  const quantity = current.quantity + added.quantity;
  if (quantity <= 0) return { ...added };
  const cost = current.quantity * current.avg_cost + added.quantity * added.avg_cost;
  return { quantity, avg_cost: Math.round((cost / quantity) * 10000) / 10000 };
}
