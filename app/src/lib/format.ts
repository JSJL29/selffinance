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

/** « 2026-11-09 » → Date à midi (évite les décalages de fuseau). */
export const parseDay = (iso: string) => new Date(`${iso}T12:00:00`);

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

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
