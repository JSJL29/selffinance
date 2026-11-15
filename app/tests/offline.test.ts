import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineStore } from '../src/lib/offline.ts';

test('un seul écran « Pas de connexion » : le premier de la page affichée', () => {
  const s = createOfflineStore();
  assert.equal(s.leader(), null);
  s.register(1, () => undefined, false); // écran resté dans la pile, pas affiché
  s.register(2, () => undefined, true);
  s.register(3, () => undefined, true);
  assert.equal(s.leader(), 2);
  s.unregister(2); // données revenues pour ce bloc
  assert.equal(s.leader(), 3);
  s.setFocused(3, false); // on change d'écran
  assert.equal(s.leader(), null);
  s.setFocused(1, true);
  assert.equal(s.leader(), 1);
});

test('retryAll : relance chaque chargement en échec de la page affichée, même si l’un échoue', async () => {
  const s = createOfflineStore();
  const calls: string[] = [];
  s.register(1, () => { calls.push('caché'); }, false);
  s.register(2, async () => { calls.push('comptes'); throw new Error('Network request failed'); }, true);
  s.register(3, async () => { calls.push('opérations'); }, true);
  await s.retryAll();
  assert.deepEqual(calls.sort(), ['comptes', 'opérations']);
});

test('subscribe : prévenu à chaque changement, plus après désabonnement', () => {
  const s = createOfflineStore();
  let n = 0;
  const off = s.subscribe(() => { n++; });
  s.register(1, () => undefined, true);
  s.setFocused(1, false);
  s.unregister(1);
  assert.equal(n, 3);
  off();
  s.register(2, () => undefined, true);
  assert.equal(n, 3);
});
