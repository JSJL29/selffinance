import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewSale } from '../src/lib/sale.ts';

test('previewSale calcule plus-value, produit et reste', () => {
  assert.deepEqual(previewSale({ quantity: 10, avg_cost: 100 }, { quantity: 4, price: 150, fees: 2 }),
    { ok: true, realized: 198, proceeds: 598, remaining: 6 });
});

test('previewSale : moins-value', () => {
  assert.deepEqual(previewSale({ quantity: 8, avg_cost: 50 }, { quantity: 5, price: 30, fees: 0 }),
    { ok: true, realized: -100, proceeds: 150, remaining: 3 });
});

test('previewSale refuse de vendre plus que détenu', () => {
  assert.deepEqual(previewSale({ quantity: 10, avg_cost: 100 }, { quantity: 11, price: 150, fees: 0 }),
    { ok: false, error: 'Tu n’as que 10 titres.' });
});

test('previewSale refuse une quantité nulle et un prix négatif', () => {
  assert.deepEqual(previewSale({ quantity: 10, avg_cost: 100 }, { quantity: 0, price: 150, fees: 0 }),
    { ok: false, error: 'Quantité invalide.' });
  assert.deepEqual(previewSale({ quantity: 10, avg_cost: 100 }, { quantity: 1, price: -1, fees: 0 }),
    { ok: false, error: 'Prix invalide.' });
});
