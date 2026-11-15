import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaleStore, staleLabel } from '../src/lib/stale.ts';

test('staleStore : la plus ancienne date périmée de la page affichée', () => {
  const s = createStaleStore();
  assert.equal(s.oldest(), null);
  s.register(1, () => undefined);
  s.register(2, () => undefined);
  s.register(3, () => undefined);
  s.setFocused(1, true); s.setFocused(2, true);
  s.setStale(1, '2026-11-15T10:00:00Z');
  s.setStale(2, '2026-11-14T09:00:00Z');
  s.setStale(3, '2026-11-01T09:00:00Z'); // écran resté dans la pile : ne compte pas
  assert.equal(s.oldest(), '2026-11-14T09:00:00Z');
  s.setStale(2, null); // rechargé
  assert.equal(s.oldest(), '2026-11-15T10:00:00Z');
  s.remove(1);
  assert.equal(s.oldest(), null);
});

test('staleStore : relance seulement les chargements périmés de la page affichée', async () => {
  const s = createStaleStore();
  const calls: number[] = [];
  for (const id of [1, 2, 3]) s.register(id, async () => { calls.push(id); if (id === 1) throw new Error('Network request failed'); });
  s.setFocused(1, true); s.setFocused(2, true);
  s.setStale(1, '2026-11-15T10:00:00Z');
  s.setStale(3, '2026-11-15T10:00:00Z');
  await s.retryAll();
  assert.deepEqual(calls, [1]);
});

test('staleStore : prévenu à chaque changement visible', () => {
  const s = createStaleStore();
  let n = 0;
  const off = s.subscribe(() => { n++; });
  s.register(1, () => undefined);
  s.setFocused(1, true);
  s.setStale(1, '2026-11-15T10:00:00Z');
  s.setStale(1, '2026-11-15T10:00:00Z'); // identique : pas de nouvel avis
  assert.equal(n, 1, 'inscription et focus sans date : rien de visible');
  s.setStale(1, null);
  assert.equal(n, 2);
  off();
});

test('staleLabel : heure de Paris, date seulement si ce n’est pas aujourd’hui', () => {
  const now = new Date('2026-11-15T18:00:00Z');
  assert.equal(staleLabel('2026-11-15T13:32:00Z', now), 'Hors connexion · données de 14:32');
  assert.equal(staleLabel('2026-11-14T13:32:00Z', now), 'Hors connexion · données du 14 nov. à 14:32');
});
