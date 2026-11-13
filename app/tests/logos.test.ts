import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoFor, normalizeBank } from '../src/lib/logos.ts';

const list = [
  { name: 'Société Générale', logo: 'https://x/sg.png' },
  { name: 'Fortuneo Banque', logo: 'https://x/fortuneo.png' },
  { name: "Caisse d'Epargne Ile De France", logo: 'https://x/ceidf.png' },
  { name: 'Sans Logo', logo: null },
];

test('normalizeBank : minuscules, sans accents ni ponctuation', () => {
  assert.equal(normalizeBank("Caisse d'Épargne Île-de-France"), 'caissedepargneiledefrance');
});

test('logoFor : nom exact', () => {
  assert.equal(logoFor('Société Générale', list), 'https://x/sg.png');
  assert.equal(logoFor("Caisse d'Epargne Ile De France", list), 'https://x/ceidf.png');
});

test('logoFor : accents et ponctuation différents', () => {
  assert.equal(logoFor('Societe generale', list), 'https://x/sg.png');
});

test('logoFor : nom saisi plus court (compte manuel)', () => {
  assert.equal(logoFor('Fortuneo', list), 'https://x/fortuneo.png');
});

test('logoFor : trop court ou inconnu → pas de logo plutôt qu’un faux', () => {
  assert.equal(logoFor('CE', list), null);
  assert.equal(logoFor('B', list), null);
  assert.equal(logoFor('IBKR', list), null);
  assert.equal(logoFor('Sans Logo', list), null);
  assert.equal(logoFor('Fortuneo', []), null);
});
