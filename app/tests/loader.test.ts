import { test } from 'node:test';
import assert from 'node:assert/strict';
import { F_LEN, S_LEN, cycle, drawState, isNetworkError } from '../src/lib/loader.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('drawState : rien au départ, tout à la fin, bornes respectées', () => {
  assert.deepEqual(drawState(0), { sOffset: S_LEN, fOffset: F_LEN, dotR: 0 });
  assert.deepEqual(drawState(1), { sOffset: 0, fOffset: 0, dotR: 4 });
  assert.deepEqual(drawState(-1), drawState(0));
  assert.deepEqual(drawState(2), drawState(1));
});

test('drawState : le S d’abord, le point au bout de la barre, puis le F', () => {
  const s = drawState(S_LEN / (S_LEN + F_LEN));
  close(s.sOffset, 0);
  close(s.fOffset, F_LEN);
  close(s.dotR, 4);
  close(S_LEN, 11.5 + 6 * Math.PI + 4 + 6 * Math.PI + 29.5);
  assert.equal(F_LEN, 32);
});

test('cycle : tracé accéléré puis freiné, pause, fondu, boucle de 2,2 s', () => {
  assert.equal(cycle(0).progress, 0);
  close(cycle(0.7).progress, 0.5);
  assert.deepEqual(cycle(1.5), { progress: 1, opacity: 1 });
  close(cycle(2.0).opacity, 0.5);
  close(cycle(2.2 + 0.7).progress, cycle(0.7).progress);
  close(cycle(2.2 + 0.7).opacity, cycle(0.7).opacity);
});

test('isNetworkError : coupure réseau seulement', () => {
  for (const m of ['TypeError: Network request failed', 'Failed to fetch',
    'NetworkError when attempting to fetch resource.', 'fetch failed', 'The request timed out']) {
    assert.equal(isNetworkError(m), true, m);
  }
  for (const m of [null, 'permission denied for table accounts', 'Clé Enable Banking invalide',
    'Edge Function returned a non-2xx status code']) {
    assert.equal(isNetworkError(m), false, String(m));
  }
});
