import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditPrice, mergePosition } from '../src/lib/positions.ts';

test('canEditPrice : titre manuel → oui', () => {
  assert.equal(canEditPrice({ price_source: 'manual', last_price: 10, price_error: null }), true);
});

test('canEditPrice : titre coté dont le cours est introuvable → oui', () => {
  assert.equal(canEditPrice({ price_source: 'yahoo', last_price: null, price_error: null }), true);
  assert.equal(canEditPrice({ price_source: 'yahoo', last_price: 12, price_error: 'Yahoo : pas de cours' }), true);
});

test('canEditPrice : titre coté avec un cours valide → non', () => {
  assert.equal(canEditPrice({ price_source: 'yahoo', last_price: 12, price_error: null }), false);
});

test('mergePosition additionne les quantités et calcule le PRU moyen pondéré', () => {
  // 42 × 400 + 10 × 520 = 22 000 → 52 titres à 423,08 €
  const m = mergePosition({ quantity: 42, avg_cost: 400 }, { quantity: 10, avg_cost: 520 });
  assert.equal(m.quantity, 52);
  assert.equal(m.avg_cost, 423.0769);
});

test('mergePosition sur une position vide reprend l’achat', () => {
  const m = mergePosition({ quantity: 0, avg_cost: 0 }, { quantity: 3, avg_cost: 10 });
  assert.deepEqual(m, { quantity: 3, avg_cost: 10 });
});
