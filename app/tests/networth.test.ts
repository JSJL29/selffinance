import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netWorth } from '../src/lib/networth.ts';

const bank = [
  { balance_eur: 46.59, hidden: false },
  { balance_eur: 6.2, hidden: false },
  { balance_eur: 999, hidden: true },     // masqué : exclu
  { balance_eur: null, hidden: false },   // solde inconnu : ignoré
];
const manual = [
  { kind: 'savings' as const, hidden: false, value_eur: 8000, invested_eur: 0, pnl_eur: 0 },
  { kind: 'investment' as const, hidden: false, value_eur: 1200, invested_eur: 1000, pnl_eur: 100 },
  { kind: 'investment' as const, hidden: false, value_eur: 3000, invested_eur: 3100, pnl_eur: -100 },
  { kind: 'investment' as const, hidden: true, value_eur: 5000, invested_eur: 1, pnl_eur: 4999 },
];

test('netWorth additionne banques, épargne et placements non masqués', () => {
  const n = netWorth(bank, manual);
  assert.equal(n.bank, 52.79);
  assert.equal(n.savings, 8000);
  assert.equal(n.investments, 4200);
  assert.equal(n.total, 12252.79);
});

test('netWorth calcule la plus-value globale sur les montants investis', () => {
  const n = netWorth(bank, manual);
  assert.equal(n.invested, 4100);
  assert.equal(n.pnl, 0);
  assert.equal(n.pnlPct, 0);
});

test('netWorth sans placement : pourcentage nul (pas de division par zéro)', () => {
  const n = netWorth([], [{ kind: 'savings', hidden: false, value_eur: 10, invested_eur: 0, pnl_eur: 0 }]);
  assert.equal(n.total, 10);
  assert.equal(n.pnlPct, null);
});

test('netWorth ignore un compte manuel sans valeur (taux de change manquant)', () => {
  const n = netWorth([], [{ kind: 'savings', hidden: false, value_eur: null, invested_eur: 0, pnl_eur: 0 }]);
  assert.equal(n.total, 0);
});
