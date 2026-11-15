// Géométrie des courbes (module pur, testé dans tests/chart.test.ts).
import type { Point } from './history';

/**
 * Ce que montre la courbe : erreur (avec « Réessayer »), chargement, pas encore assez de points
 * (« La courbe se remplit… »), ou la courbe. `points` null = en cours de chargement.
 */
export function chartState(points: Point[] | null, error: string | null): 'error' | 'loading' | 'empty' | 'ready' {
  if (error) return 'error';
  if (!points) return 'loading';
  return points.filter((p) => p.value != null).length < 2 ? 'empty' : 'ready';
}

/** Domaine vertical : valeurs connues + 10 % de marge ; valeur constante → ligne au milieu ; rien → [0, 1]. */
export function yDomain(values: (number | null)[]): [number, number] {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!known.length) return [0, 1];
  const min = Math.min(...known);
  const max = Math.max(...known);
  const pad = min === max ? Math.max(Math.abs(min) * 0.01, 1) : (max - min) * 0.1;
  return [min - pad, max + pad];
}

/** Graduations « rondes » (1, 2, 2,5 ou 5 × 10ⁿ) comprises dans [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step); // évite 0,30000000000000004
  }
  return ticks;
}

/** Échelle linéaire domaine → pixels. */
export function scale([d0, d1]: [number, number], [r0, r1]: [number, number]): (v: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Montant court pour les graduations : « 500 € », « 2,5 k€ », « 1,5 M€ ». */
export function compactEuro(v: number): string {
  const a = Math.abs(v);
  const [x, unit] = a >= 1e6 ? [a / 1e6, 'M€'] : a >= 1000 ? [a / 1000, 'k€'] : [a, '€'];
  const s = String(Math.round(x * 10) / 10).replace('.', ',');
  return `${v < 0 ? '−' : ''}${s} ${unit}`;
}

/**
 * Libellé d'une graduation, assez précis pour que deux graduations voisines (écart `step`) diffèrent :
 * forme courte (« 40 k€ ») pour les grands pas, montant entier ou décimal (« 43 225 € ») quand la courbe est zoomée.
 */
export function tickLabel(v: number, step: number): string {
  const unit = Math.abs(v) >= 1e6 ? 1e6 : 1000;
  if (step >= unit / 10) return compactEuro(v);
  const decimals = step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step) - 1e-9));
  const s = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .format(Math.abs(v)).replace(/\s/g, ' ');
  return `${v < 0 ? '−' : ''}${s} €`;
}

/** Variation du premier au dernier point connu (montant au centime, part en fraction) ; null s'il en manque. */
export function variation(points: Point[]): { abs: number; pct: number | null; from: string } | null {
  const known = points.filter((p): p is Point & { value: number } => p.value != null && Number.isFinite(p.value));
  if (known.length < 2) return null;
  const first = known[0];
  const last = known[known.length - 1];
  const abs = Math.round((last.value - first.value) * 100) / 100;
  return { abs, pct: first.value === 0 ? null : (last.value - first.value) / Math.abs(first.value), from: first.date };
}

const n = (v: number) => String(Math.round(v * 10) / 10);

/** Tracé SVG ; un point sans valeur coupe le trait (trou, jamais un zéro). */
export function linePath(points: { x: number; y: number | null }[]): string {
  const parts: string[] = [];
  let pen = false;
  for (const p of points) {
    if (p.y == null || !Number.isFinite(p.y)) { pen = false; continue; }
    parts.push(`${pen ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`);
    pen = true;
  }
  return parts.join(' ');
}

/** Index de l'abscisse la plus proche ; -1 si aucune. */
export function nearestIndex(xs: number[], x: number): number {
  let best = -1;
  for (let i = 0; i < xs.length; i++) {
    if (best < 0 || Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  }
  return best;
}
