// Période de transactions demandée à Enable Banking (module pur, testé dans period.test.ts).
//
// Hors de la connexion (authentification forte juste faite), beaucoup de banques limitent
// l'historique accessible : Caisse d'Épargne refuse au-delà de 62 jours
// (422 WRONG_TRANSACTIONS_PERIOD). Sans opération récente sur un compte, « dernière opération
// − 7 jours » dépassait cette limite et la synchro échouait.

export const FIRST_DAYS = 90; // premier import
export const OVERLAP_DAYS = 7; // on recharge toujours la dernière semaine (opérations en cours)
export const MAX_ROUTINE_DAYS = 60; // synchro habituelle : sous la limite la plus stricte connue (62 j)

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysBefore = (n: number, from: Date) => isoDay(new Date(from.getTime() - n * DAY));

/**
 * Date de début de la synchro d'un compte.
 * `forceDays` (reprise demandée par le serveur) : pris tel quel.
 * Sinon dernière opération − 7 jours (90 jours au premier import), jamais plus de 60 jours en arrière.
 */
export function syncFrom(now: Date, lastBooking: string | null, forceDays: number | null): string {
  if (forceDays) return daysBefore(forceDays, now);
  const wanted = lastBooking ? daysBefore(OVERLAP_DAYS, new Date(lastBooking)) : daysBefore(FIRST_DAYS, now);
  const floor = daysBefore(MAX_ROUTINE_DAYS, now);
  return wanted < floor ? floor : wanted;
}

/** Limite indiquée par la banque dans une erreur de période (« more than 62 days »), sinon null. */
export function periodLimitDays(error: string): number | null {
  if (!error.includes("WRONG_TRANSACTIONS_PERIOD")) return null;
  const m = error.match(/more than (\d+) days/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 1 ? n : null;
}
