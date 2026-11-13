// Lancer : node --test supabase/functions/sync/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodLimitDays, syncFrom } from './period.ts';

const now = new Date('2026-11-13T14:00:00Z');

test('compte actif : dernière opération − 7 jours', () => {
  assert.equal(syncFrom(now, '2026-11-10', null), '2026-11-03');
});

test('premier import : limité à 60 jours hors connexion', () => {
  assert.equal(syncFrom(now, null, null), '2026-09-14');
});

test('compte sans opération récente (CE IDF) : jamais plus de 60 jours en arrière', () => {
  // dernière opération le 17 août → 10 août = 95 jours, refusé par la banque (limite 62 jours)
  assert.equal(syncFrom(now, '2026-08-17', null), '2026-09-14');
});

test('reprise forcée : période demandée telle quelle', () => {
  assert.equal(syncFrom(now, '2026-11-10', 90), '2026-08-15');
});

test('lit la limite dans l’erreur Enable Banking', () => {
  const err = 'Error: EB /accounts/x/transactions -> 422 {"code":422,"message":"Wrong transactions period requested",' +
    '"detail":{"message":"You can not access transactions more than 62 days in the past."},"error":"WRONG_TRANSACTIONS_PERIOD"}';
  assert.equal(periodLimitDays(err), 62);
});

test('autre erreur : pas de nouvel essai', () => {
  assert.equal(periodLimitDays('EB /accounts/x/transactions -> 500 boom'), null);
  assert.equal(periodLimitDays('WRONG_TRANSACTIONS_PERIOD sans nombre'), null);
});
