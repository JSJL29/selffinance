// Total du Patrimoine (module pur, testé dans tests/networth.test.ts).

export type BankLike = { balance_eur: number | null; hidden: boolean };
export type ManualLike = {
  kind: 'savings' | 'investment';
  hidden: boolean;
  value_eur: number | null;
  invested_eur: number;
  pnl_eur: number;
};

export type NetWorth = {
  total: number;
  bank: number;
  savings: number;
  investments: number;
  invested: number;
  pnl: number;
  pnlPct: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comptes bancaires + comptes manuels non masqués ; plus-value sur les placements uniquement. */
export function netWorth(bank: BankLike[], manual: ManualLike[]): NetWorth {
  const sum = (xs: (number | null)[]) => round2(xs.reduce<number>((s, x) => s + (x ?? 0), 0));
  const visible = manual.filter((m) => !m.hidden);
  const inv = visible.filter((m) => m.kind === 'investment');

  const b = sum(bank.filter((x) => !x.hidden).map((x) => x.balance_eur));
  const savings = sum(visible.filter((m) => m.kind === 'savings').map((m) => m.value_eur));
  const investments = sum(inv.map((m) => m.value_eur));
  const invested = sum(inv.map((m) => m.invested_eur));
  const pnl = sum(inv.map((m) => m.pnl_eur));

  return {
    total: round2(b + savings + investments),
    bank: b,
    savings,
    investments,
    invested,
    pnl,
    pnlPct: invested > 0 ? pnl / invested : null,
  };
}
