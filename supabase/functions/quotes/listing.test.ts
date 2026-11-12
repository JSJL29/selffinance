// Lancer : node --test supabase/functions/quotes/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickListing } from './listing.ts';

const hits = [
  { symbol: 'NVD.DE', currency: 'EUR' },
  { symbol: 'NVDA', currency: 'USD' },
  { symbol: 'NVDA.MX', currency: 'MXN' },
  { symbol: 'NVDA.NE', currency: 'USD' },
];

test('pickListing prend la première cotation dans la devise du titre', () => {
  assert.equal(pickListing(hits, 'USD'), 'NVDA');
  assert.equal(pickListing(hits, 'EUR'), 'NVD.DE');
});

test('pickListing : aucune cotation dans la devise → null (pas de cours dans une autre devise)', () => {
  assert.equal(pickListing(hits, 'GBP'), null);
  assert.equal(pickListing([], 'USD'), null);
});

test('pickListing avec symbole imposé : seulement cette cotation (ticker IBKR, « BRK B » → « BRK-B »)', () => {
  const byTicker = [
    { symbol: 'GOOGL', currency: 'USD' }, { symbol: 'GGLL', currency: 'USD' }, { symbol: 'GOOGL.SN', currency: 'USD' },
  ];
  assert.equal(pickListing(byTicker, 'USD', 'GOOGL'), 'GOOGL');
  assert.equal(pickListing([{ symbol: 'GGLL', currency: 'USD' }], 'USD', 'GOOGL'), null);
  assert.equal(pickListing([{ symbol: 'BRK-B', currency: 'USD' }], 'USD', 'BRK B'), 'BRK-B');
});
