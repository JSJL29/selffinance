const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

export function money(n: number, currency = 'EUR', opts: { sign?: boolean } = {}): string {
  const s = nf.format(Math.abs(n));
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${s} ${SYMBOLS[currency] ?? currency}`;
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** « 2026-11-09 » (ou un horodatage complet) → Date à midi du jour (évite les décalages de fuseau). */
export const parseDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

export function dayLabel(iso: string): string {
  const today = new Date();
  const d = parseDay(iso);
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  return dayFmt.format(d);
}

export const monthLabel = (d: Date) => {
  const s = monthFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const shortDate = (iso: string) => shortFmt.format(parseDay(iso));

export function ago(iso: string | null): string {
  if (!iso) return 'jamais synchronisé';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

export function maskIban(iban: string | null): string {
  if (!iban) return '';
  const s = iban.replace(/\s+/g, '');
  return `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
}

/** Lit un montant saisi à la française (« 1 234,56 », « 512,3 € », « -3.2 »). Renvoie null si invalide. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[\s  €]/g, '');
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

const pctFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 0.0712 → « +7,1 % » ; null → « — ». */
export function pct(x: number | null): string {
  if (x == null) return '—';
  const s = `${pctFmt.format(Math.abs(x) * 100)} %`;
  return x > 0 ? `+${s}` : x < 0 ? `−${s}` : s;
}

/** « 05/11/2026 » → « 2026-11-05 » ; null si la date n'existe pas. */
export function parseFrDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** « 2026-11-05 » → « 05/11/2026 ». */
export const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
