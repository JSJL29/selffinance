// Historique du patrimoine (module pur, testé dans tests/history.test.ts ; n'importe pas supabase).
// Une ligne de `wealth_snapshots` = la valeur d'un compte un jour donné (photo de 22 h).

export type Period = '1S' | '1M' | '3M' | '1A' | 'Tout';
export const PERIODS: Period[] = ['1S', '1M', '3M', '1A', 'Tout'];

export type SnapshotRow = {
  date: string;
  bank_uid: string | null;
  manual_id: string | null;
  value_eur: number | null;
  invested_eur: number | null;
  missing: number;
};

/** Un point de courbe ; `doubtful` : une valeur ou un cours manquait ce jour-là. */
export type Point = { date: string; value: number | null; doubtful: boolean };

const pad = (n: number) => String(n).padStart(2, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Début de la période (« AAAA-MM-JJ », calcul sur la date seule : pas de décalage de fuseau) ; null pour Tout. */
export function periodStart(period: Period, today: string): string | null {
  if (period === 'Tout') return null;
  const [y, m, d] = today.split('-').map(Number);
  if (period === '1S') {
    const t = new Date(Date.UTC(y, m - 1, d - 7));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const months = period === '1M' ? 1 : period === '3M' ? 3 : 12;
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, daysInMonth))}`;
}

/**
 * Lit toutes les pages d'une requête : le serveur renvoie au plus 1000 lignes (max_rows), et l'historique
 * compte une ligne par compte et par jour. Sans cela, les jours les plus récents disparaîtraient.
 */
export async function fetchAllPages<T>(page: (from: number, to: number) => Promise<T[]>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const rows = await page(from, from + size - 1);
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/** Somme par jour des lignes retenues, par date croissante. */
function sumByDay(rows: SnapshotRow[], keep: (r: SnapshotRow) => boolean, field: 'value_eur' | 'invested_eur'): Point[] {
  const days = new Map<string, { sum: number; known: number; doubtful: boolean }>();
  for (const r of rows) {
    if (!keep(r)) continue;
    const day = days.get(r.date) ?? { sum: 0, known: 0, doubtful: false };
    const v = r[field];
    if (v == null) day.doubtful = true;
    else { day.sum += v; day.known++; }
    if (r.missing > 0) day.doubtful = true;
    days.set(r.date, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, x]) => ({ date, value: x.known ? round2(x.sum) : null, doubtful: x.doubtful }));
}

/** Total du patrimoine par jour : comptes non masqués aujourd'hui, valeurs connues (même règle que netWorth). */
export function totalSeries(rows: SnapshotRow[], visible: { bank: Set<string>; manual: Set<string> }): Point[] {
  return sumByDay(rows, (r) => (r.bank_uid != null ? visible.bank.has(r.bank_uid) : visible.manual.has(r.manual_id ?? '')), 'value_eur')
    .map((p) => ({ ...p, value: p.value ?? 0 }));
}

/** Courbe d'un compte ou d'un groupe de comptes (ex. Revolut EUR + USD). */
export function accountSeries(rows: SnapshotRow[], match: (r: SnapshotRow) => boolean, field: 'value_eur' | 'invested_eur'): Point[] {
  return sumByDay(rows, match, field);
}
