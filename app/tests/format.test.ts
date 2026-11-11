// Lancer : node --test tests/   (Node ≥ 23 exécute le TypeScript directement)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, pct, shortDate } from '../src/lib/format.ts';

test('shortDate accepte une date seule et un horodatage complet', () => {
  assert.equal(shortDate('2027-02-08T22:18:28.977+00:00'), shortDate('2027-02-08'));
  assert.equal(shortDate('2027-02-08 22:18:28.977+00'), shortDate('2027-02-08'));
});

test('parseAmount accepte la virgule décimale française', () => {
  assert.equal(parseAmount('512,30'), 512.3);
});

test('parseAmount accepte les séparateurs de milliers (espace, espace insécable)', () => {
  assert.equal(parseAmount('1 234,5'), 1234.5);
  assert.equal(parseAmount('1 234,5'), 1234.5);
  assert.equal(parseAmount('12 000'), 12000);
});

test('parseAmount accepte le point et le signe moins', () => {
  assert.equal(parseAmount('-3.2'), -3.2);
  assert.equal(parseAmount('  42 € '), 42);
});

test('parseAmount refuse le vide et le texte', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1,2,3'), null);
});

test('pct affiche un pourcentage signé à la française', () => {
  assert.equal(pct(0.0712), '+7,1 %');
  assert.equal(pct(-0.021), '−2,1 %');
  assert.equal(pct(0), '0,0 %');
  assert.equal(pct(null), '—');
});
