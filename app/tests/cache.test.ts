import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/lib/cache.ts';

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
const at = '2026-11-15T13:32:00.000Z';

test('cache : relit ce qui a été écrit, avec sa date', () => {
  const c = createCache(memory(), () => at);
  assert.equal(c.read('comptes'), null);
  c.write('comptes', [{ uid: 'a', balance: 12.5 }]);
  assert.deepEqual(c.read('comptes'), { at, data: [{ uid: 'a', balance: 12.5 }] });
});

test('cache : copie illisible ou stockage en panne → comme sans copie, jamais d’erreur', () => {
  const s = memory();
  s.setItem('cache.v1.comptes', '{pas du json');
  assert.equal(createCache(s, () => at).read('comptes'), null);
  const broken = { getItem: () => { throw new Error('disk'); }, setItem: () => { throw new Error('disk'); }, removeItem: () => { throw new Error('disk'); } };
  const c = createCache(broken, () => at);
  assert.equal(c.read('comptes'), null);
  assert.doesNotThrow(() => c.write('comptes', [1]));
  assert.doesNotThrow(() => c.clear());
});

test('cache : clear efface toutes les copies (déconnexion), rien d’autre', () => {
  const s = memory();
  s.setItem('transactions.hideInternal', '1');
  s.setItem('sb-session', 'jeton');
  const c = createCache(s, () => at);
  c.write('comptes', [1]);
  c.write('tx:2026-11', [2]);
  c.clear();
  assert.equal(c.read('comptes'), null);
  assert.equal(c.read('tx:2026-11'), null);
  assert.deepEqual([...s.m.keys()].sort(), ['sb-session', 'transactions.hideInternal']);
});

test('cache : une réponse partie avant la déconnexion ne recrée pas de copie', () => {
  const c = createCache(memory(), () => at);
  const gen = c.generation(); // requête lancée
  c.clear(); // déconnexion pendant la requête
  c.write('comptes', [1], gen); // la réponse arrive
  assert.equal(c.read('comptes'), null);
  c.write('comptes', [2], c.generation());
  assert.deepEqual(c.read('comptes')?.data, [2]);
});

test('cache : copie à moitié écrite (stockage plein) quand même effacée à la déconnexion', () => {
  const s = memory();
  const c = createCache({ ...s, setItem: (k: string, v: string) => { if (k === 'cache.v1.__keys' && v.includes('gros')) throw new Error('plein'); s.setItem(k, v); } }, () => at);
  c.write('gros', [1]);
  c.write('petit', [2]);
  c.clear();
  assert.deepEqual([...s.m.keys()], []);
});
