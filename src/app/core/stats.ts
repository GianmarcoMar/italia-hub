/**
 * Statistica di base per la dashboard: medie, correlazioni (Pearson e Spearman), retta dei minimi quadrati,
 * gruppi per quantile. Funzioni pure, testate in stats.spec.ts.
 */

export const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** Media pesata; i pesi nulli o negativi non contano. */
export function wmean(v: number[], w: number[]): number {
  let s = 0;
  let t = 0;
  v.forEach((x, i) => {
    const wi = w[i] > 0 ? w[i] : 0;
    s += x * wi;
    t += wi;
  });
  return t ? s / t : NaN;
}

export const median = (v: number[]): number => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Tiene solo le coppie in cui entrambi i valori sono numeri finiti. */
export function pairs(a: (number | null | undefined)[], b: (number | null | undefined)[]): { x: number[]; y: number[]; idx: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const p = a[i];
    const q = b[i];
    if (typeof p === 'number' && typeof q === 'number' && Number.isFinite(p) && Number.isFinite(q)) {
      x.push(p);
      y.push(q);
      idx.push(i);
    }
  }
  return { x, y, idx };
}

/** Coefficiente di Pearson; null con meno di 3 punti o se una delle serie è costante. */
export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3 || y.length !== n) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Posizioni in classifica (1 = il minore); i pari merito ricevono la posizione media. */
export function ranks(v: number[]): number[] {
  const order = v.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(v.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = r;
    i = j + 1;
  }
  return out;
}

/** Correlazione di Spearman (di rango): robusta ai valori estremi, come i redditi dei comuni piccoli. */
export const spearman = (x: number[], y: number[]): number | null => (x.length < 3 ? null : pearson(ranks(x), ranks(y)));

export interface Line {
  slope: number;
  intercept: number;
  r2: number;
}

/** Retta dei minimi quadrati y = slope·x + intercept. */
export function linreg(x: number[], y: number[]): Line | null {
  const r = pearson(x, y);
  if (r === null) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: r * r };
}

export type Strength = 'trascurabile' | 'debole' | 'moderata' | 'forte' | 'molto forte';

/** Etichetta d'uso comune per |r|: 0,2 / 0,4 / 0,6 / 0,8. */
export function strength(r: number): Strength {
  const a = Math.abs(r);
  return a < 0.2 ? 'trascurabile' : a < 0.4 ? 'debole' : a < 0.6 ? 'moderata' : a < 0.8 ? 'forte' : 'molto forte';
}

export interface Group {
  /** estremi di x nel gruppo */
  from: number;
  to: number;
  n: number;
  /** media di x e media (eventualmente pesata) di y nel gruppo */
  x: number;
  y: number;
}

/**
 * Divide le unità in `k` gruppi di uguale numerosità in base a x (dal più basso al più alto)
 * e calcola la media di y in ciascuno. Con `w` la media di y è pesata (es. per popolazione).
 */
export function quantileGroups(x: number[], y: number[], k = 5, w?: number[]): Group[] {
  const n = x.length;
  if (n < k) return [];
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const out: Group[] = [];
  for (let g = 0; g < k; g++) {
    const part = order.slice(Math.floor((g * n) / k), Math.floor(((g + 1) * n) / k));
    const ys = part.map(i => y[i]);
    out.push({
      from: x[part[0]],
      to: x[part[part.length - 1]],
      n: part.length,
      x: mean(part.map(i => x[i])),
      y: w ? wmean(ys, part.map(i => w[i])) : mean(ys),
    });
  }
  return out;
}

/** Valori "tondi" (1, 2, 5 × 10ⁿ) per gli assi, da `min` a `max` inclusi se cadono su un valore tondo. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  return out;
}

/** Correlazione tra due colonne con valori mancanti: ρ di Spearman, r di Pearson, n e retta. */
export interface Relation {
  n: number;
  rho: number;
  r: number;
  line: Line;
}

export function relation(a: (number | null)[], b: (number | null)[]): Relation | null {
  const { x, y } = pairs(a, b);
  const rho = spearman(x, y);
  const r = pearson(x, y);
  const line = linreg(x, y);
  return rho === null || r === null || !line ? null : { n: x.length, rho, r, line };
}
