import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoFor, makeLogoLookup, normalizeBank } from '../src/lib/logos.ts';

test('logoFor : un mot générique seul ne donne pas le logo d’une autre banque', () => {
  const l = [{ name: 'Crédit Agricole Ile-de-France', logo: 'https://x/ca.png' }, { name: 'Banque Populaire', logo: 'https://x/bp.png' }];
  assert.equal(logoFor('Crédit', l), null);
  assert.equal(logoFor('Banque', l), null);
  assert.equal(logoFor('Crédit Agricole', l), 'https://x/ca.png', 'mots entiers en tête : ok');
});

test('logoFor : préfixe seulement sur des mots entiers', () => {
  const l = [{ name: 'Crédit Mutuel de Bretagne', logo: 'https://x/cmb.png' }, { name: 'Boursorama', logo: 'https://x/bourso.png' }];
  assert.equal(logoFor('Crédit Mutuel', l), 'https://x/cmb.png');
  assert.equal(logoFor('Bourso', l), null, 'un morceau de mot ne suffit pas');
});

test('makeLogoLookup : mêmes réponses que logoFor, liste normalisée une seule fois', () => {
  const look = makeLogoLookup(list);
  assert.equal(look('Societe generale'), 'https://x/sg.png');
  assert.equal(look('Fortuneo'), 'https://x/fortuneo.png');
  assert.equal(look('CE'), null);
  assert.equal(look('Fortuneo'), 'https://x/fortuneo.png', 'réponse mise en cache');
});

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
