import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactEuro, linePath, nearestIndex, niceTicks, scale, yDomain } from '../src/lib/chart.ts';

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
