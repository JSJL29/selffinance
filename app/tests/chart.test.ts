import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartState, compactEuro, linePath, nearestIndex, niceTicks, scale, tickLabel, variation, yDomain } from '../src/lib/chart.ts';

test('chartState : erreur et chargement ne sont pas confondus avec « pas encore de données »', () => {
  const two = [{ date: '2026-11-12', value: 1, doubtful: false }, { date: '2026-11-13', value: 2, doubtful: false }];
  assert.equal(chartState(null, 'Réseau indisponible'), 'error');
  assert.equal(chartState(two, 'Réseau indisponible'), 'error');
  assert.equal(chartState(null, null), 'loading');
  assert.equal(chartState([two[0]], null), 'empty');
  assert.equal(chartState([{ ...two[0], value: null }, two[1]], null), 'empty');
  assert.equal(chartState(two, null), 'ready');
});

test('compactEuro : graduations courtes', () => {
  assert.equal(compactEuro(40000), '40 k€');
  assert.equal(compactEuro(2500), '2,5 k€');
  assert.equal(compactEuro(-1000), '−1 k€');
  assert.equal(compactEuro(500), '500 €');
  assert.equal(compactEuro(1500000), '1,5 M€');
  assert.equal(compactEuro(0), '0 €');
});

test('yDomain : vide, constant, avec marge et négatifs', () => {
  assert.deepEqual(yDomain([]), [0, 1]);
  assert.deepEqual(yDomain([null, null]), [0, 1]);
  const [lo, hi] = yDomain([500, 500]);
  assert.ok(lo < 500 && 500 < hi, 'livret qui ne bouge pas : ligne au milieu');
  const [a, b] = yDomain([-200, null, 1000]);
  assert.ok(a < -200 && b > 1000);
});

test('niceTicks : pas ronds, dans le domaine, négatifs compris', () => {
  const t = niceTicks(0, 47980);
  assert.ok(t.length >= 2);
  assert.ok(t.every((v) => v % 10000 === 0 && v >= 0 && v <= 47980), String(t));
  const n = niceTicks(-1000, 3000);
  assert.ok(n.includes(0) && n.some((v) => v < 0), String(n));
  assert.ok(niceTicks(5, 5).length >= 1);
});

test('scale : linéaire, axe Y inversé possible', () => {
  const y = scale([0, 100], [200, 0]);
  assert.equal(y(0), 200);
  assert.equal(y(50), 100);
  assert.equal(y(100), 0);
});

test('linePath : un point, trou sur null, rien', () => {
  assert.equal(linePath([]), '');
  assert.equal(linePath([{ x: 0, y: 5 }]), 'M0 5');
  const p = linePath([{ x: 0, y: 1 }, { x: 10, y: 2 }, { x: 20, y: null }, { x: 30, y: 4 }]);
  assert.equal(p, 'M0 1 L10 2 M30 4');
  assert.ok(!p.includes('NaN'));
});

test('nearestIndex : point le plus proche du doigt', () => {
  assert.equal(nearestIndex([0, 10, 20], 14), 1);
  assert.equal(nearestIndex([0, 10, 20], 16), 2);
  assert.equal(nearestIndex([], 3), -1);
});

test('tickLabel : graduations distinctes même quand la courbe est très zoomée', () => {
  // Patrimoine de 43 216 € qui bouge de 15 € : pas de 5 €, jamais « 43,2 k€ » trois fois.
  const ticks = niceTicks(43215, 43233);
  const labels = ticks.map((v) => tickLabel(v, ticks[1] - ticks[0]));
  assert.equal(new Set(labels).size, labels.length, labels.join(' | '));
  assert.equal(tickLabel(43225, 5), '43 225 €');
  assert.equal(tickLabel(4652.5, 0.5), '4 652,5 €');
  // Grands pas : forme courte inchangée.
  assert.equal(tickLabel(40000, 10000), '40 k€');
  assert.equal(tickLabel(2500, 500), '2,5 k€');
  assert.equal(tickLabel(-1000, 1000), '−1 k€');
});

test('variation : du premier au dernier point connu', () => {
  const p = (date: string, value: number | null) => ({ date, value, doubtful: false });
  const v = variation([p('2026-11-12', null), p('2026-11-13', 4652.32), p('2026-11-14', 4660.87), p('2026-11-15', null)]);
  assert.ok(v);
  assert.equal(v.abs, 8.55);
  assert.ok(Math.abs((v.pct ?? 0) - 8.55 / 4652.32) < 1e-12);
  assert.equal(v.from, '2026-11-13');
  assert.equal(variation([p('2026-11-13', 10)]), null, 'un seul point : pas de variation');
  assert.equal(variation([p('2026-11-13', 0), p('2026-11-14', 5)])?.pct, null, 'départ à 0 : pas de pourcentage');
});
