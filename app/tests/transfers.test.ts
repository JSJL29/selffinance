import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, pairTransfers } from '../src/lib/transfers.ts';
import type { Tx } from '../src/lib/data.ts';

let n = 0;
const tx = (date: string, uid: string, bank: string, amount: number, extra: Partial<Tx> = {}): Tx => ({
  id: ++n, account_uid: uid, booking_date: date, amount, currency: 'EUR', counterparty: null, description: null,
  status: 'BOOK', is_internal: true, internal_label: null, bank, iban: null, amount_eur: amount, ...extra,
});

const kinds = (items: ReturnType<typeof pairTransfers>) => items.map((i) => i.kind);

test('paire simple SG → BNP à un jour d’écart : une seule ligne, à la place du débit', () => {
  const out = tx('2026-11-05', 'sg', 'Société Générale', -1000);
  const inn = tx('2026-11-06', 'bnp', 'BNP Paribas', 1000);
  const other = tx('2026-11-05', 'sg', 'Société Générale', -12, { is_internal: false });
  const items = pairTransfers([inn, out, other]);
  assert.deepEqual(kinds(items), ['transfer', 'tx']);
  const t = items[0];
  assert.ok(t.kind === 'transfer' && t.out === out && t.in === inn);
});

test('pas de paire : même compte, même signe, autre devise, plus de 3 jours, non interne', () => {
  const sg = (amount: number, date = '2026-11-05', extra: Partial<Tx> = {}) => tx(date, 'sg', 'SG', amount, extra);
  const bnp = (amount: number, date = '2026-11-05', extra: Partial<Tx> = {}) => tx(date, 'bnp', 'BNP', amount, extra);
  assert.deepEqual(kinds(pairTransfers([sg(-100), sg(100)])), ['tx', 'tx'], 'même compte');
  assert.deepEqual(kinds(pairTransfers([sg(-100), bnp(-100)])), ['tx', 'tx'], 'même signe');
  assert.deepEqual(kinds(pairTransfers([sg(-100), bnp(100, '2026-11-05', { currency: 'USD' })])), ['tx', 'tx'], 'devise');
  assert.deepEqual(kinds(pairTransfers([sg(-100, '2026-11-01'), bnp(100, '2026-11-05')])), ['tx', 'tx'], '4 jours');
  assert.deepEqual(kinds(pairTransfers([sg(-100), bnp(100, '2026-11-05', { is_internal: false })])), ['tx', 'tx'], 'non interne');
  assert.deepEqual(kinds(pairTransfers([sg(-100), bnp(99.5)])), ['tx', 'tx'], 'montants différents');
});

test('deux virements identiques le même jour : deux paires, aucune opération réutilisée', () => {
  const a = tx('2026-11-05', 'sg', 'SG', -50);
  const b = tx('2026-11-05', 'sg', 'SG', -50);
  const c = tx('2026-11-05', 'bnp', 'BNP', 50);
  const d = tx('2026-11-05', 'bnp', 'BNP', 50);
  const items = pairTransfers([a, b, c, d]);
  assert.deepEqual(kinds(items), ['transfer', 'transfer']);
  const used = items.flatMap((i) => (i.kind === 'transfer' ? [i.out.id, i.in.id] : []));
  assert.equal(new Set(used).size, 4);
});

test('le crédit le plus proche en date est choisi', () => {
  const out = tx('2026-11-05', 'sg', 'SG', -200);
  const far = tx('2026-11-08', 'bnp', 'BNP', 200);
  const near = tx('2026-11-06', 'rev', 'Revolut', 200);
  const items = pairTransfers([far, near, out]);
  const t = items.find((i) => i.kind === 'transfer');
  assert.ok(t && t.kind === 'transfer' && t.in === near);
  assert.equal(items.length, 2, 'le crédit lointain reste seul');
});

test('groupByDay : une paire est rangée au jour du débit', () => {
  const out = tx('2026-11-05', 'sg', 'SG', -1000);
  const inn = tx('2026-11-06', 'bnp', 'BNP', 1000);
  const other = tx('2026-11-06', 'sg', 'SG', -5, { is_internal: false });
  const sections = groupByDay(pairTransfers([other, inn, out]));
  assert.deepEqual(sections.map((s) => [s.title, s.data.length]), [['2026-11-06', 1], ['2026-11-05', 1]]);
});
