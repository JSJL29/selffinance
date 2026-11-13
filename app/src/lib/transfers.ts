// Virements entre ses propres banques (module pur, testé dans tests/transfers.test.ts).
// SG −1 000 € et BNP +1 000 € sont deux opérations ; dans la liste, on les montre en une ligne « SG → BNP ».
import type { Tx } from './data';

export type ListItem = { kind: 'tx'; tx: Tx } | { kind: 'transfer'; out: Tx; in: Tx };

const MAX_DAYS = 3;
const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/**
 * Réunit chaque débit interne avec le crédit interne correspondant : autre compte, même devise, montant
 * opposé (au centime), au plus 3 jours d'écart ; le plus proche en date, chaque opération une seule fois.
 * L'ordre de la liste est gardé ; la paire prend la place du débit.
 * `manualNames` : noms des comptes manuels. Un virement vers l'un d'eux (Livret A, PEA…) n'a pas de
 * contrepartie bancaire : il n'est jamais apparié (sinon « SG → BNP » pourrait réunir deux virements sans rapport).
 */
export function pairTransfers(txs: Tx[], manualNames: Set<string> = new Set()): ListItem[] {
  const pairable = (t: Tx) => t.is_internal && !(t.internal_label && manualNames.has(t.internal_label));
  const ins = txs.filter((t) => pairable(t) && t.amount > 0);
  const used = new Set<Tx>();
  const pairOf = new Map<Tx, Tx>();
  for (const out of txs) {
    if (!pairable(out) || out.amount >= 0) continue;
    let best: Tx | null = null;
    let bestGap = Infinity;
    for (const cand of ins) {
      if (used.has(cand) || cand.account_uid === out.account_uid || cand.currency !== out.currency) continue;
      if (Math.abs(cand.amount + out.amount) >= 0.005) continue;
      const gap = Math.abs(day(cand.booking_date) - day(out.booking_date));
      if (gap <= MAX_DAYS && gap < bestGap) { best = cand; bestGap = gap; }
    }
    if (best) { used.add(best); pairOf.set(out, best); }
  }
  const items: ListItem[] = [];
  for (const t of txs) {
    if (used.has(t)) continue; // crédit déjà affiché avec son débit
    const inn = pairOf.get(t);
    items.push(inn ? { kind: 'transfer', out: t, in: inn } : { kind: 'tx', tx: t });
  }
  return items;
}

/** Liste sans les virements internes (paires « SG → BNP » comprises) : il ne reste que les vraies dépenses et rentrées. */
export function withoutInternal(items: ListItem[]): ListItem[] {
  return items.filter((i) => i.kind === 'tx' && !i.tx.is_internal);
}

const dateOf = (i: ListItem) => (i.kind === 'tx' ? i.tx.booking_date : i.out.booking_date);

/** Sections par jour pour SectionList (liste déjà triée par date) ; une paire au jour du débit. */
export function groupByDay(items: ListItem[]): { title: string; data: ListItem[] }[] {
  const sections: { title: string; data: ListItem[] }[] = [];
  for (const i of items) {
    const last = sections[sections.length - 1];
    if (last && last.title === dateOf(i)) last.data.push(i);
    else sections.push({ title: dateOf(i), data: [i] });
  }
  return sections;
}
