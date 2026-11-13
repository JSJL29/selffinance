// Géométrie des courbes (module pur, testé dans tests/chart.test.ts).

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
