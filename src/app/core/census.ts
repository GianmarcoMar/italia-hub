/**
 * Dati statici sui comuni (public/data, generati da scripts/build-data.mjs) e calcoli su di essi:
 * aggregazioni per provincia/regione/Italia, classifiche, classi per le mappe coropletiche.
 * Funzioni pure, testate in census.spec.ts.
 */
import { Step } from './analysis';

export interface CensusFile {
  generated: string;
  popYears: number[];
  incomeYears: number[];
  sources: Record<string, string>;
  fields: string[];
  rows: Record<string, (string | number | null)[]>;
}

export interface Comune {
  /** Codice catastale (Belfiore): chiave stabile. */
  k: string;
  name: string;
  istat: string;
  prov: number;
  provAcr: string;
  reg: number;
  /** km² */
  area: number;
  /** punto interno al comune */
  x: number;
  y: number;
  pop: number | null;
  pop20: number | null;
  male: number | null;
  female: number | null;
  ageMean: number | null;
  pct0_14: number | null;
  pct65: number | null;
  pctMarried: number | null;
  foreign: number | null;
  taxpayers: number | null;
  /** reddito complessivo medio per contribuente, € (anni d'imposta 2024, 2019, 2014) */
  inc: number | null;
  inc19: number | null;
  inc14: number | null;
}

/** Dettaglio per comune, file per regione (public/data/dettaglio/R{n}.json). */
export interface ComuneDetail {
  /** piramide: maschi e femmine per fasce di 5 anni (0-4 … 95-99, 100+) */
  bm?: number[];
  bf?: number[];
  /** contribuenti per fascia di reddito: ≤10k, 10-15k, 15-26k, 26-55k, 55-75k, 75-120k, >120k */
  ib?: number[];
  /** ammontari: lavoro dipendente, pensione, lavoro autonomo, totale */
  comp?: number[];
  /** popolazione al 1° gennaio (popYears) */
  ps: (number | null)[];
  /** reddito medio per anno d'imposta (incomeYears) */
  is: (number | null)[];
}

export function parseCensus(f: CensusFile): Map<string, Comune> {
  const idx = Object.fromEntries(f.fields.map((name, i) => [name, i]));
  const out = new Map<string, Comune>();
  for (const [k, r] of Object.entries(f.rows)) {
    const get = (name: string) => r[idx[name]] ?? null;
    const n = (name: string) => {
      const v = get(name);
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    out.set(k, {
      k,
      name: String(get('name') ?? k),
      istat: String(get('istat') ?? ''),
      prov: n('prov') ?? 0,
      provAcr: String(get('provAcr') ?? ''),
      reg: n('reg') ?? 0,
      area: n('area') ?? 0,
      x: n('x') ?? 0,
      y: n('y') ?? 0,
      pop: n('pop'),
      pop20: n('pop20'),
      male: n('male'),
      female: n('female'),
      ageMean: n('ageMean'),
      pct0_14: n('pct0_14'),
      pct65: n('pct65'),
      pctMarried: n('pctMarried'),
      foreign: n('foreign'),
      taxpayers: n('taxpayers'),
      inc: n('inc'),
      inc19: n('inc19'),
      inc14: n('inc14'),
    });
  }
  return out;
}

// ---------- aggregazioni ----------

export interface Aggregate {
  comuni: number;
  pop: number;
  /** popolazione 2020 dei soli comuni con il dato (per una variazione omogenea) */
  pop20: number;
  popComparable: number;
  male: number;
  female: number;
  area: number;
  density: number | null;
  ageMean: number | null;
  pct0_14: number | null;
  pct65: number | null;
  /** indice di vecchiaia: over 65 ogni 100 under 15 */
  oldAgeIndex: number | null;
  foreign: number;
  pctForeign: number | null;
  taxpayers: number;
  inc: number | null;
  inc19: number | null;
  inc14: number | null;
  /** variazioni percentuali */
  popChange: number | null;
  incChange5: number | null;
  incChange10: number | null;
}

/** Somma e medie pesate (età e quote per popolazione, redditi per contribuenti). */
export function aggregate(list: Comune[]): Aggregate {
  let pop = 0, pop20 = 0, popComparable = 0, male = 0, female = 0, area = 0, foreign = 0, taxpayers = 0;
  let ageW = 0, y14W = 0, o65W = 0, wPop = 0;
  let incW = 0, inc19W = 0, inc14W = 0, w19 = 0, w14 = 0;
  for (const c of list) {
    area += c.area;
    if (c.pop) {
      pop += c.pop;
      male += c.male ?? 0;
      female += c.female ?? 0;
      foreign += c.foreign ?? 0;
      if (c.ageMean !== null && c.pct0_14 !== null && c.pct65 !== null) {
        ageW += c.ageMean * c.pop;
        y14W += c.pct0_14 * c.pop;
        o65W += c.pct65 * c.pop;
        wPop += c.pop;
      }
      if (c.pop20) {
        pop20 += c.pop20;
        popComparable += c.pop;
      }
    }
    if (c.taxpayers && c.inc !== null) {
      taxpayers += c.taxpayers;
      incW += c.inc * c.taxpayers;
      // per gli anni passati si pesa con i contribuenti attuali: approssimazione dichiarata
      if (c.inc19 !== null) {
        inc19W += c.inc19 * c.taxpayers;
        w19 += c.taxpayers;
      }
      if (c.inc14 !== null) {
        inc14W += c.inc14 * c.taxpayers;
        w14 += c.taxpayers;
      }
    }
  }
  const inc = taxpayers ? incW / taxpayers : null;
  const inc19 = w19 ? inc19W / w19 : null;
  const inc14 = w14 ? inc14W / w14 : null;
  const pct0_14 = wPop ? y14W / wPop : null;
  const pct65 = wPop ? o65W / wPop : null;
  return {
    comuni: list.length,
    pop,
    pop20,
    popComparable,
    male,
    female,
    area,
    density: area ? pop / area : null,
    ageMean: wPop ? ageW / wPop : null,
    pct0_14,
    pct65,
    oldAgeIndex: pct0_14 && pct65 !== null ? (pct65 / pct0_14) * 100 : null,
    foreign,
    pctForeign: pop ? (foreign / pop) * 100 : null,
    taxpayers,
    inc,
    inc19,
    inc14,
    popChange: pop20 ? ((popComparable - pop20) / pop20) * 100 : null,
    incChange5: inc && inc19 ? ((inc - inc19) / inc19) * 100 : null,
    incChange10: inc && inc14 ? ((inc - inc14) / inc14) * 100 : null,
  };
}

/** Aggregato di un singolo comune, così i pannelli trattano comuni e territori allo stesso modo. */
export const single = (c: Comune) => aggregate([c]);

/** Somma elemento per elemento di array numerici (piramidi, fasce di reddito, serie). */
export function sumArrays(list: ((number | null)[] | undefined)[]): number[] {
  const out: number[] = [];
  for (const a of list) {
    if (!a) continue;
    a.forEach((v, i) => (out[i] = (out[i] ?? 0) + (v ?? 0)));
  }
  return out;
}

/** Posizione (1 = il maggiore) di `k` tra i comuni per il valore dato. */
export function rankOf(list: Comune[], k: string, value: (c: Comune) => number | null): { rank: number; of: number } | null {
  const valid = list.filter(c => value(c) !== null);
  const mine = valid.find(c => c.k === k);
  if (!mine) return null;
  const v = value(mine)!;
  return { rank: valid.filter(c => value(c)! > v).length + 1, of: valid.length };
}

/** Il comune più popoloso di un gruppo: per le province è quasi sempre il capoluogo. */
export function mostPopulous(list: Comune[]): Comune | null {
  return list.reduce<Comune | null>((m, c) => (!m || (c.pop ?? 0) > (m.pop ?? 0) ? c : m), null);
}

// ---------- indicatori per la coropleta dei comuni ----------

export interface ComuneMetric {
  id: string;
  label: string;
  unit: string;
  /** sequenziale (quantili) o divergente (soglie fisse attorno a zero) */
  kind: 'seq' | 'div';
  value: (c: Comune) => number | null;
  digits: number;
}

const pct = (a: number | null, b: number | null) => (a !== null && b ? ((a - b) / b) * 100 : null);

export const COMUNE_METRICS: ComuneMetric[] = [
  { id: 'density', label: 'Densità abitativa', unit: 'ab/km²', kind: 'seq', digits: 0, value: c => (c.pop && c.area ? c.pop / c.area : null) },
  { id: 'pop', label: 'Popolazione', unit: 'ab', kind: 'seq', digits: 0, value: c => c.pop },
  { id: 'popChange', label: 'Variazione popolazione 2020–25', unit: '%', kind: 'div', digits: 1, value: c => pct(c.pop, c.pop20) },
  { id: 'age', label: 'Età media', unit: 'anni', kind: 'seq', digits: 1, value: c => c.ageMean },
  { id: 'old', label: 'Over 65', unit: '%', kind: 'seq', digits: 1, value: c => c.pct65 },
  { id: 'foreign', label: 'Stranieri residenti', unit: '%', kind: 'seq', digits: 1, value: c => (c.pop && c.foreign !== null ? (c.foreign / c.pop) * 100 : null) },
  { id: 'income', label: 'Reddito medio 2024', unit: '€', kind: 'seq', digits: 0, value: c => c.inc },
  { id: 'incomeChange', label: 'Variazione reddito 2019–24', unit: '%', kind: 'div', digits: 1, value: c => pct(c.inc, c.inc19) },
];

export const metricById = (id: string) => COMUNE_METRICS.find(m => m.id === id);

/** Scala sequenziale leggibile su fondo scuro e chiaro (stile "inferno"). */
export const SEQ_COLORS = ['#2c115f', '#721f81', '#b73779', '#f1605d', '#fca50a', '#fcfdbf'];
/** Divergente: rosso = calo, verde = crescita. */
export const DIV_COLORS = ['#b2182b', '#ef8a62', '#fddbc7', '#d9f0d3', '#7fbf7b', '#1b7837'];
const DIV_BREAKS: Record<string, number[]> = {
  popChange: [-Infinity, -5, -2, 0, 2, 5],
  incomeChange: [-Infinity, 5, 10, 15, 20, 25],
};

/** Soglie ai quantili (n classi), arrotondate per una legenda leggibile. */
export function quantileBreaks(values: number[], n = 6): number[] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [-Infinity];
  for (let i = 1; i < n; i++) {
    const q = v[Math.min(v.length - 1, Math.floor((i / n) * v.length))];
    out.push(nice(q));
  }
  return [...new Set(out)];
}

function nice(x: number): number {
  if (x === 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(x)) - 1);
  return Math.round(x / mag) * mag;
}

/** Classi della legenda per un indicatore, calcolate su tutti i comuni. */
export function metricSteps(m: ComuneMetric, all: Comune[]): Step[] {
  const breaks = m.kind === 'div' ? DIV_BREAKS[m.id] : quantileBreaks(all.map(m.value).filter((x): x is number => x !== null));
  const colors = m.kind === 'div' ? DIV_COLORS : SEQ_COLORS.slice(SEQ_COLORS.length - breaks.length);
  const fmt = (x: number) => x.toLocaleString('it-IT', { maximumFractionDigits: m.digits });
  return breaks.map((min, i) => ({
    min,
    color: colors[i],
    label: i === 0 ? `< ${fmt(breaks[1] ?? 0)}` : i === breaks.length - 1 ? `≥ ${fmt(min)}` : `${fmt(min)}–${fmt(breaks[i + 1])}`,
  }));
}
