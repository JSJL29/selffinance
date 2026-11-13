import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountSeries, periodStart, totalSeries, type SnapshotRow } from '../src/lib/history.ts';

const row = (date: string, ref: { bank?: string; manual?: string }, value: number | null, extra: Partial<SnapshotRow> = {}): SnapshotRow => ({
  date, bank_uid: ref.bank ?? null, manual_id: ref.manual ?? null, value_eur: value, invested_eur: null, missing: 0, ...extra,
});

test('periodStart : 3 mois, 1 semaine, fin de mois ramenée, Tout', () => {
  assert.equal(periodStart('3M', '2026-11-13'), '2026-08-13');
  assert.equal(periodStart('1S', '2026-03-01'), '2026-02-22');
  assert.equal(periodStart('1M', '2026-03-31'), '2026-02-28');
  assert.equal(periodStart('1A', '2026-11-13'), '2025-11-13');
  assert.equal(periodStart('Tout', '2026-11-13'), null);
});

test('totalSeries : somme par jour des comptes visibles, triée par date', () => {
  const rows = [
    row('2026-11-12', { bank: 'b1' }, 100),
    row('2026-11-11', { bank: 'b1' }, 90),
    row('2026-11-12', { manual: 'm1' }, 50),
    row('2026-11-12', { manual: 'masque' }, 1000),
  ];
  const s = totalSeries(rows, { bank: new Set(['b1']), manual: new Set(['m1']) });
  assert.deepEqual(s, [
    { date: '2026-11-11', value: 90, doubtful: false },
    { date: '2026-11-12', value: 150, doubtful: false },
  ]);
});

test('totalSeries : valeur inconnue ou cours manquant → somme des autres, point douteux', () => {
  const visible = { bank: new Set(['b1', 'b2']), manual: new Set(['m1']) };
  const s = totalSeries([
    row('2026-11-12', { bank: 'b1' }, 100),
    row('2026-11-12', { bank: 'b2' }, null),
    row('2026-11-13', { bank: 'b1' }, 100),
    row('2026-11-13', { manual: 'm1' }, 40, { missing: 2 }),
  ], visible);
  assert.deepEqual(s, [
    { date: '2026-11-12', value: 100, doubtful: true },
    { date: '2026-11-13', value: 140, doubtful: true },
  ]);
});

test('accountSeries : somme d’un groupe bancaire, toutes nulles → null, champ investi', () => {
  const rows = [
    row('2026-11-12', { bank: 'eur' }, 100),
    row('2026-11-12', { bank: 'usd' }, 20),
    row('2026-11-13', { bank: 'eur' }, null),
    row('2026-11-13', { bank: 'usd' }, null),
    row('2026-11-13', { bank: 'autre' }, 5),
  ];
  const inGroup = (r: SnapshotRow) => ['eur', 'usd'].includes(r.bank_uid ?? '');
  assert.deepEqual(accountSeries(rows, inGroup, 'value_eur'), [
    { date: '2026-11-12', value: 120, doubtful: false },
    { date: '2026-11-13', value: null, doubtful: true },
  ]);
  const pea = [row('2026-11-12', { manual: 'pea' }, 1200, { invested_eur: 1000 })];
  assert.deepEqual(accountSeries(pea, (r) => r.manual_id === 'pea', 'invested_eur'), [
    { date: '2026-11-12', value: 1000, doubtful: false },
  ]);
});
