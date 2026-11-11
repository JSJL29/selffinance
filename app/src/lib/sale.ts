// Aperçu d'une vente avant validation (module pur, testé dans tests/sale.test.ts).
// Même calcul que la fonction SQL sell_position : PRU des titres restants inchangé.

type Held = { quantity: number; avg_cost: number };
type Sale = { quantity: number; price: number; fees: number };
export type SalePreview =
  | { ok: true; realized: number; proceeds: number; remaining: number }
  | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function previewSale(held: Held, sale: Sale): SalePreview {
  if (!(sale.quantity > 0)) return { ok: false, error: 'Quantité invalide.' };
  if (sale.quantity > held.quantity) {
    return { ok: false, error: `Tu n’as que ${String(held.quantity).replace('.', ',')} titres.` };
  }
  if (!(sale.price >= 0)) return { ok: false, error: 'Prix invalide.' };
  if (!(sale.fees >= 0)) return { ok: false, error: 'Frais invalides.' };
  return {
    ok: true,
    realized: round2((sale.price - held.avg_cost) * sale.quantity - sale.fees),
    proceeds: round2(sale.quantity * sale.price - sale.fees),
    remaining: round2(held.quantity - sale.quantity),
  };
}
