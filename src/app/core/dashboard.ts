/**
 * Dashboard di analisi incrociata: variabili confrontabili, unità (comuni, province, regioni),
 * tabelle per macro-area e per dimensione dei comuni, e le conclusioni calcolate dai dati.
 * Funzioni pure, testate in dashboard.spec.ts. Ogni frase delle conclusioni nasce da un numero calcolato qui.
 */
import { Aggregate, Comune, aggregate } from './census';
import { Climate } from './history';
import { mean, median, quantileGroups, relation, strength, wmean } from './stats';

export type Level = 'comune' | 'province' | 'region';

export const LEVELS: { id: Level; label: string }[] = [
  { id: 'comune', label: 'Comuni' },
  { id: 'province', label: 'Province' },
  { id: 'region', label: 'Regioni' },
];

// ---------- variabili ----------

export type VarId =
  | 'density'
  | 'popChange'
  | 'ageMean'
  | 'pct65'
  | 'pct0_14'
  | 'foreign'
  | 'inc'
  | 'incChange'
  | 'taxRatio'
  | 'quakeRate'
  | 'tempMean'
  | 'tempTrend'
  | 'rain';

export interface VarDef {
  id: VarId;
  label: string;
  unit: string;
  digits: number;
  /** scala logaritmica nei grafici (distribuzioni molto asimmetriche) */
  log?: boolean;
  /** a quali livelli esiste il dato */
  levels: Level[];
  /** dati che vanno caricati a parte */
  needs?: 'quake' | 'climate';
}

const ALL: Level[] = ['comune', 'province', 'region'];

export const VARS: VarDef[] = [
  { id: 'density', label: 'Densità abitativa', unit: 'ab/km²', digits: 0, log: true, levels: ALL },
  { id: 'popChange', label: 'Variazione popolazione 2020–25', unit: '%', digits: 1, levels: ALL },
  { id: 'ageMean', label: 'Età media', unit: 'anni', digits: 1, levels: ALL },
  { id: 'pct65', label: 'Over 65', unit: '%', digits: 1, levels: ALL },
  { id: 'pct0_14', label: 'Under 15', unit: '%', digits: 1, levels: ALL },
  { id: 'foreign', label: 'Stranieri residenti', unit: '%', digits: 1, levels: ALL },
  { id: 'inc', label: 'Reddito medio 2024', unit: '€', digits: 0, levels: ALL },
  { id: 'incChange', label: 'Variazione reddito 2019–24', unit: '%', digits: 1, levels: ALL },
  { id: 'taxRatio', label: 'Contribuenti ogni 100 abitanti', unit: '', digits: 1, levels: ALL },
  { id: 'quakeRate', label: 'Terremoti M3+ dal 1985 per 1.000 km²', unit: '', digits: 2, levels: ['province', 'region'], needs: 'quake' },
  { id: 'tempMean', label: 'Temperatura media annua (capoluogo)', unit: '°C', digits: 1, levels: ['region'], needs: 'climate' },
  { id: 'tempTrend', label: 'Tendenza della temperatura', unit: '°C/decennio', digits: 2, levels: ['region'], needs: 'climate' },
  { id: 'rain', label: 'Pioggia annua (capoluogo)', unit: 'mm', digits: 0, levels: ['region'], needs: 'climate' },
];

export const varById = (id: VarId): VarDef => VARS.find(v => v.id === id)!;

/** Numero all'italiana, sempre con il punto delle migliaia (7.896, non 7896) e la virgola dei decimali. */
export function fmt(v: number, digits = 0): string {
  const [int, dec] = Math.abs(v).toFixed(digits).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = v < 0 && Number(`${int}.${dec ?? 0}`) !== 0 ? '-' : '';
  return sign + grouped + (dec ? `,${dec}` : '');
}

/** "1.234 €" / "+2,5 %" / "42,1 anni": valore con unità, il segno solo per le variazioni. */
export function fmtVar(def: VarDef, v: number): string {
  const signed = def.id === 'popChange' || def.id === 'incChange' || def.id === 'tempTrend';
  const s = (signed && v > 0 ? '+' : '') + fmt(v, def.digits);
  return def.unit ? (def.unit === '%' ? `${s}%` : `${s} ${def.unit}`) : s;
}

// ---------- macro-aree (ripartizioni ISTAT) ----------

export type AreaId = 'NO' | 'NE' | 'C' | 'S' | 'I';

export const AREAS: { id: AreaId; name: string; color: string; regs: number[] }[] = [
  { id: 'NO', name: 'Nord-ovest', color: '#4c9be8', regs: [1, 2, 3, 7] },
  { id: 'NE', name: 'Nord-est', color: '#2dd4bf', regs: [4, 5, 6, 8] },
  { id: 'C', name: 'Centro', color: '#f5a524', regs: [9, 10, 11, 12] },
  { id: 'S', name: 'Sud', color: '#e86a8a', regs: [13, 14, 15, 16, 17, 18] },
  { id: 'I', name: 'Isole', color: '#a78bfa', regs: [19, 20] },
];

export const areaOfRegion = (reg: number): AreaId => AREAS.find(a => a.regs.includes(reg))?.id ?? 'C';

// ---------- unità di analisi ----------

export interface Unit {
  id: string;
  name: string;
  level: Level;
  reg: number;
  prov: number | null;
  area: AreaId;
  /** sigla della provincia, per distinguere i comuni omonimi */
  sub?: string;
  pop: number;
  v: Partial<Record<VarId, number | null>>;
}

const pctChange = (now: number | null, before: number | null): number | null => (now !== null && before ? ((now - before) / before) * 100 : null);

export function comuneUnit(c: Comune): Unit {
  const pop = c.pop ?? 0;
  return {
    id: c.k,
    name: c.name,
    level: 'comune',
    reg: c.reg,
    prov: c.prov,
    area: areaOfRegion(c.reg),
    sub: c.provAcr,
    pop,
    v: {
      density: pop && c.area ? pop / c.area : null,
      popChange: c.pop && c.pop20 ? pctChange(c.pop, c.pop20) : null,
      ageMean: c.ageMean,
      pct65: c.pct65,
      pct0_14: c.pct0_14,
      foreign: pop && c.foreign !== null ? (c.foreign / pop) * 100 : null,
      inc: c.inc,
      incChange: pctChange(c.inc, c.inc19),
      taxRatio: pop && c.taxpayers ? (c.taxpayers / pop) * 100 : null,
    },
  };
}

export function aggregateUnit(
  level: 'province' | 'region',
  id: string,
  name: string,
  reg: number,
  prov: number | null,
  a: Aggregate,
  extra: Partial<Record<VarId, number | null>> = {},
): Unit {
  return {
    id,
    name,
    level,
    reg,
    prov,
    area: areaOfRegion(reg),
    pop: a.pop,
    v: {
      density: a.density,
      popChange: a.popChange,
      ageMean: a.ageMean,
      pct65: a.pct65,
      pct0_14: a.pct0_14,
      foreign: a.pctForeign,
      inc: a.inc,
      incChange: a.incChange5,
      taxRatio: a.pop ? (a.taxpayers / a.pop) * 100 : null,
      ...extra,
    },
  };
}

/** Valori di una variabile per una lista di unità (null dove manca). */
const column = (units: Unit[], id: VarId): (number | null)[] => units.map(u => u.v[id] ?? null);

// ---------- tabelle ----------

export interface AreaRow {
  id: AreaId;
  name: string;
  color: string;
  agg: Aggregate;
  popShare: number;
  foreignShare: number;
}

export function areaTable(list: Comune[]): AreaRow[] {
  const total = aggregate(list);
  return AREAS.map(a => {
    const agg = aggregate(list.filter(c => a.regs.includes(c.reg)));
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      agg,
      popShare: total.pop ? (agg.pop / total.pop) * 100 : 0,
      foreignShare: total.foreign ? (agg.foreign / total.foreign) * 100 : 0,
    };
  });
}

const SIZE_CLASSES = [
  { id: 'xs', label: 'meno di 1.000', max: 1000 },
  { id: 'sm', label: '1.000–5.000', max: 5000 },
  { id: 'md', label: '5.000–20.000', max: 20000 },
  { id: 'lg', label: '20.000–100.000', max: 100000 },
  { id: 'xl', label: 'oltre 100.000', max: Infinity },
];

export const sizeClassOf = (pop: number): number => SIZE_CLASSES.findIndex(s => pop < s.max);

export interface SizeRow {
  label: string;
  comuni: number;
  agg: Aggregate;
  popShare: number;
  /** quota di comuni della classe che hanno perso abitanti dal 2020 */
  shrinkingShare: number | null;
}

export function sizeTable(list: Comune[]): SizeRow[] {
  const withPop = list.filter(c => c.pop);
  const total = withPop.reduce((s, c) => s + (c.pop ?? 0), 0);
  return SIZE_CLASSES.map((s, i) => {
    const part = withPop.filter(c => sizeClassOf(c.pop!) === i);
    const agg = aggregate(part);
    const comparable = part.filter(c => c.pop20);
    return {
      label: s.label,
      comuni: part.length,
      agg,
      popShare: total ? (agg.pop / total) * 100 : 0,
      shrinkingShare: comparable.length ? (comparable.filter(c => c.pop! < c.pop20!).length / comparable.length) * 100 : null,
    };
  });
}

// ---------- dati caricati a parte ----------

/** Eventi per provincia → densità (per 1.000 km²) per provincia e per regione. */
export function quakeRates(
  counts: Map<number, number>,
  provinces: { prov: number; reg: number; area: number }[],
): { byProv: Map<number, number>; byReg: Map<number, number> } {
  const byProv = new Map<number, number>();
  const regN = new Map<number, number>();
  const regArea = new Map<number, number>();
  for (const p of provinces) {
    const n = counts.get(p.prov) ?? 0;
    if (p.area > 0) byProv.set(p.prov, (n / p.area) * 1000);
    regN.set(p.reg, (regN.get(p.reg) ?? 0) + n);
    regArea.set(p.reg, (regArea.get(p.reg) ?? 0) + p.area);
  }
  const byReg = new Map([...regN].map(([r, n]) => [r, regArea.get(r)! > 0 ? (n / regArea.get(r)!) * 1000 : 0]));
  return { byProv, byReg };
}

/** Variabili climatiche di una serie NASA POWER: ultimi 30 anni completi per medie, tendenza sull'intera serie. */
export function climateVars(c: Climate): Partial<Record<VarId, number | null>> {
  const last = c.years.slice(-30);
  return {
    tempMean: last.length ? mean(last.map(y => y.t)) : null,
    rain: last.length ? mean(last.map(y => y.p)) : null,
    tempTrend: c.trendPerDecade,
  };
}

export type AlertCounts = [number, number, number, number];

export interface AlertExposure {
  comuni: AlertCounts;
  pop: AlertCounts;
  over65: AlertCounts;
}

/** Comuni, abitanti e over 65 per livello d'allerta (0 nessuna … 3 rossa). */
export function alertExposure(list: Comune[], levelOf: (c: Comune) => number): AlertExposure {
  const out: AlertExposure = { comuni: [0, 0, 0, 0], pop: [0, 0, 0, 0], over65: [0, 0, 0, 0] };
  for (const c of list) {
    const l = Math.min(3, Math.max(0, levelOf(c)));
    out.comuni[l]++;
    out.pop[l] += c.pop ?? 0;
    out.over65[l] += ((c.pop ?? 0) * (c.pct65 ?? 0)) / 100;
  }
  return out;
}

// ---------- conclusioni ----------

export type Tone = 'info' | 'warn' | 'good';

export interface Insight {
  id: string;
  group: 'divari' | 'demografia' | 'relazioni' | 'rischi';
  title: string;
  text: string;
  tone: Tone;
  /** numeri che reggono la frase, mostrati sotto */
  facts?: string[];
  /** cosa fare per verificare: colorare la mappa o aprire il grafico */
  action?: { kind: 'map'; choro: string; label: string } | { kind: 'plot'; level: Level; x: VarId; y: VarId; label: string };
  /** forza della relazione, per ordinare le schede */
  weight?: number;
}

export interface InsightInput {
  comuni: Comune[];
  units: Record<Level, Unit[]>;
  quake?: { total: number; fromYear: number };
  alerts?: { exposure: AlertExposure; title: string | null };
}

const SEGNO = (r: number) => (r >= 0 ? 'positiva' : 'negativa');

/** Etichetta dentro una frase: solo l'iniziale in minuscolo ("over 65", "terremoti M3+"). */
const phrase = (d: VarDef) => d.label.charAt(0).toLowerCase() + d.label.slice(1);

/** t di Student al 5% a due code, per i gradi di libertà più comuni. */
function tCrit(df: number): number {
  return df >= 120 ? 1.98 : df >= 60 ? 2.0 : df >= 30 ? 2.04 : df >= 20 ? 2.09 : df >= 15 ? 2.13 : df >= 10 ? 2.23 : 2.4;
}

/** La correlazione è distinguibile dal caso (5%)? Con migliaia di punti lo è quasi sempre: conta la forza. */
export function isSignificant(r: number, n: number): boolean {
  if (n < 5) return false;
  if (Math.abs(r) >= 1) return true;
  const df = n - 2;
  return Math.abs(r) * Math.sqrt(df / (1 - r * r)) > tCrit(df);
}

/** Coppie (x, y) da confrontare a ciascun livello. */
export const PAIRS: { level: Level; x: VarId; y: VarId }[] = [
  { level: 'comune', x: 'pct65', y: 'inc' },
  { level: 'comune', x: 'density', y: 'inc' },
  { level: 'comune', x: 'foreign', y: 'inc' },
  { level: 'comune', x: 'foreign', y: 'popChange' },
  { level: 'comune', x: 'pct65', y: 'popChange' },
  { level: 'comune', x: 'density', y: 'popChange' },
  { level: 'comune', x: 'foreign', y: 'pct0_14' },
  { level: 'comune', x: 'inc', y: 'taxRatio' },
  { level: 'province', x: 'quakeRate', y: 'density' },
  { level: 'province', x: 'quakeRate', y: 'inc' },
  { level: 'province', x: 'quakeRate', y: 'pct65' },
  { level: 'region', x: 'tempMean', y: 'inc' },
  { level: 'region', x: 'tempMean', y: 'pct65' },
  { level: 'region', x: 'tempTrend', y: 'popChange' },
];

/** Sostantivo, articolo e suddivisione per ciascun livello ("Tra i 7.896 comuni", "Tra le 20 regioni"). */
const LEVEL_TEXT: Record<Level, { noun: string; art: string; part: string; partWithArt: string }> = {
  comune: { noun: 'comuni', art: 'i', part: 'quinto', partWithArt: 'Nel quinto' },
  province: { noun: 'province', art: 'le', part: 'quinto', partWithArt: 'Nel quinto' },
  region: { noun: 'regioni', art: 'le', part: 'metà', partWithArt: 'Nella metà' },
};

/** Frase e numeri per una relazione tra due variabili. Ritorna null se i dati non bastano. */
export function relationInsight(level: Level, xId: VarId, yId: VarId, units: Unit[]): Insight | null {
  const x = varById(xId);
  const y = varById(yId);
  const xs = column(units, xId);
  const ys = column(units, yId);
  const rel = relation(xs, ys);
  if (!rel) return null;

  const idx = xs.map((v, i) => (v !== null && ys[i] !== null ? i : -1)).filter(i => i >= 0);
  const gx = idx.map(i => xs[i]!);
  const gy = idx.map(i => ys[i]!);
  const groups = quantileGroups(gx, gy, level === 'region' ? 2 : 5);
  const lo = groups[0];
  const hi = groups.at(-1);
  const { noun, art, part, partWithArt } = LEVEL_TEXT[level];
  const s = strength(rel.rho);
  const sig = isSignificant(rel.rho, rel.n);
  const base = `Tra ${art} ${fmt(rel.n)} ${noun}`;
  const rho = `ρ = ${fmt(rel.rho, 2)}`;

  let text: string;
  if (s === 'trascurabile') {
    text = `${base}, ${phrase(x)} e ${phrase(y)} non mostrano una relazione apprezzabile (${rho}).`;
  } else if (!sig) {
    // una correlazione di quella forza con così pochi dati può essere un caso
    text = `${base} si intravede una correlazione ${s} ${SEGNO(rel.rho)} tra ${phrase(x)} e ${phrase(y)} (${rho}), ma con così pochi dati non si distingue dal caso.`;
  } else {
    text = `${base}, ${phrase(x)} e ${phrase(y)} hanno una correlazione ${s} ${SEGNO(rel.rho)} (${rho}).`;
    if (lo && hi) {
      text += ` ${partWithArt} con i valori più alti di ${phrase(x)}, ${phrase(y)} vale in media ${fmtVar(y, hi.y)}; nel${part === 'metà' ? 'la' : ''} ${part} con i valori più bassi ${fmtVar(y, lo.y)}.`;
    }
    if (level === 'region') text += ' Con solo 20 regioni il risultato è indicativo.';
  }

  return {
    id: `rel-${level}-${xId}-${yId}`,
    group: 'relazioni',
    title: `${x.label} e ${phrase(y)}`,
    text,
    tone: 'info',
    facts: [`ρ di Spearman ${fmt(rel.rho, 2)}`, `r di Pearson ${fmt(rel.r, 2)}`, `n = ${fmt(rel.n)}`, `R² ${fmt(rel.line.r2, 2)}`],
    action: { kind: 'plot', level, x: xId, y: yId, label: 'Apri il grafico' },
    // le relazioni che potrebbero essere un caso passano dopo le altre
    weight: sig ? Math.abs(rel.rho) : Math.abs(rel.rho) / 2,
  };
}

function incomeGap(areas: AreaRow[], provinces: Unit[]): Insight | null {
  const ok = areas.filter(a => a.agg.inc !== null);
  if (ok.length < 2) return null;
  const hi = ok.reduce((m, a) => (a.agg.inc! > m.agg.inc! ? a : m));
  const lo = ok.reduce((m, a) => (a.agg.inc! < m.agg.inc! ? a : m));
  const ps = provinces.filter(p => p.v.inc != null).sort((a, b) => b.v.inc! - a.v.inc!);
  const facts = ok.map(a => `${a.name}: ${fmt(a.agg.inc!)} €`);
  let text = `Il reddito medio per contribuente (anno d'imposta 2024) va da ${fmt(lo.agg.inc!)} € nel ${lo.name} a ${fmt(hi.agg.inc!)} € nel ${hi.name}: il ${fmt((hi.agg.inc! / lo.agg.inc! - 1) * 100)}% in più.`;
  if (ps.length > 2) {
    const a = ps[0];
    const b = ps[ps.length - 1];
    text += ` Tra le province, da ${a.name} (${fmt(a.v.inc!)} €) a ${b.name} (${fmt(b.v.inc!)} €).`;
  }
  return {
    id: 'income-gap',
    group: 'divari',
    title: 'Il divario di reddito tra le aree',
    text,
    tone: 'warn',
    facts,
    action: { kind: 'map', choro: 'c:income', label: 'Mostra sulla mappa' },
  };
}

function incomeTrend(comuni: Comune[]): Insight | null {
  const ok = comuni.filter(c => c.inc !== null && c.inc19 && c.taxpayers);
  if (ok.length < 30) return null;
  const total = aggregate(ok);
  if (total.incChange5 === null) return null;
  const rel = relation(
    ok.map(c => c.inc19),
    ok.map(c => ((c.inc! - c.inc19!) / c.inc19!) * 100),
  );
  let verdict = '';
  if (rel && Math.abs(rel.rho) >= 0.1) {
    verdict =
      rel.rho < 0
        ? ` I comuni con redditi iniziali più bassi sono cresciuti di più (ρ = ${fmt(rel.rho, 2)}): il divario si restringe.`
        : ` I comuni con redditi iniziali più alti sono cresciuti di più (ρ = ${fmt(rel.rho, 2)}): il divario si allarga.`;
  } else if (rel) {
    verdict = ` La crescita non dipende dal livello di partenza (ρ = ${fmt(rel.rho, 2)}).`;
  }
  return {
    id: 'income-trend',
    group: 'divari',
    title: 'Come è cresciuto il reddito in cinque anni',
    text: `Il reddito medio per contribuente è cresciuto del ${fmt(total.incChange5, 1)}% tra il 2019 e il 2024, in valori nominali (non depurati dall'inflazione).${verdict}`,
    tone: 'info',
    facts: [`n = ${fmt(ok.length)} comuni`],
    action: { kind: 'map', choro: 'c:incomeChange', label: 'Mostra sulla mappa' },
  };
}

function shrinking(comuni: Comune[], sizes: SizeRow[]): Insight | null {
  const ok = comuni.filter(c => c.pop && c.pop20);
  if (ok.length < 30) return null;
  const loss = ok.filter(c => c.pop! < c.pop20!);
  const lossPop = loss.reduce((s, c) => s + c.pop!, 0);
  const allPop = ok.reduce((s, c) => s + c.pop!, 0);
  const small = sizes.slice(0, 2);
  const smallShare = (() => {
    const part = ok.filter(c => c.pop! < 5000);
    return part.length ? (part.filter(c => c.pop! < c.pop20!).length / part.length) * 100 : null;
  })();
  const bigShare = (() => {
    const part = ok.filter(c => c.pop! >= 5000);
    return part.length ? (part.filter(c => c.pop! < c.pop20!).length / part.length) * 100 : null;
  })();
  const total = aggregate(ok);
  const change = total.popChange ?? 0;
  const trend = change < 0 ? `è scesa dell'${fmt(-change, 1)}%` : `è salita del ${fmt(change, 1)}%`;
  let text = `Dal 2020 al 2025 il ${fmt((loss.length / ok.length) * 100)}% dei comuni ha perso abitanti, e vi abita il ${fmt((lossPop / allPop) * 100)}% della popolazione. La popolazione italiana ${trend}.`;
  if (smallShare !== null && bigShare !== null) {
    text += ` Sotto i 5.000 abitanti ha perso residenti il ${fmt(smallShare)}% dei comuni, sopra quella soglia il ${fmt(bigShare)}%.`;
  }
  return {
    id: 'shrinking',
    group: 'demografia',
    title: 'Lo spopolamento dei comuni piccoli',
    text,
    tone: 'warn',
    facts: small.map(s => `${s.label}: ${s.agg.popChange === null ? 'n.d.' : fmt(s.agg.popChange, 1) + '%'} (${fmt(s.comuni)} comuni)`),
    action: { kind: 'map', choro: 'c:popChange', label: 'Mostra sulla mappa' },
  };
}

function ageing(provinces: Unit[], italy: Aggregate): Insight | null {
  const ps = provinces.filter(p => p.v.ageMean != null).sort((a, b) => b.v.ageMean! - a.v.ageMean!);
  if (ps.length < 3 || italy.ageMean === null) return null;
  const old = ps.slice(0, 3);
  const young = ps.slice(-3).reverse();
  const list = (xs: Unit[]) => xs.map(p => `${p.name} (${fmt(p.v.ageMean!, 1)})`).join(', ');
  return {
    id: 'ageing',
    group: 'demografia',
    title: 'Un Paese che invecchia',
    text: `L'età media è ${fmt(italy.ageMean, 1)} anni e ci sono ${fmt(italy.oldAgeIndex ?? 0)} over 65 ogni 100 under 15. Le province più anziane sono ${list(old)}; le più giovani ${list(young)}.`,
    tone: 'warn',
    facts: [`over 65: ${fmt(italy.pct65 ?? 0, 1)}%`, `under 15: ${fmt(italy.pct0_14 ?? 0, 1)}%`],
    action: { kind: 'map', choro: 'c:age', label: 'Mostra sulla mappa' },
  };
}

function foreignDistribution(areas: AreaRow[]): Insight | null {
  const north = areas.filter(a => a.id === 'NO' || a.id === 'NE');
  const popN = north.reduce((s, a) => s + a.popShare, 0);
  const forN = north.reduce((s, a) => s + a.foreignShare, 0);
  const total = areas.reduce((s, a) => s + a.agg.foreign, 0);
  if (!total) return null;
  return {
    id: 'foreign-geo',
    group: 'divari',
    title: 'Dove vivono i residenti stranieri',
    text: `Il Nord ospita il ${fmt(forN)}% dei residenti stranieri a fronte del ${fmt(popN)}% della popolazione. La quota di stranieri va da ${fmt(Math.min(...areas.map(a => a.agg.pctForeign ?? Infinity)), 1)}% a ${fmt(Math.max(...areas.map(a => a.agg.pctForeign ?? 0)), 1)}% a seconda dell'area.`,
    tone: 'info',
    facts: areas.map(a => `${a.name}: ${fmt(a.agg.pctForeign ?? 0, 1)}%`),
    action: { kind: 'map', choro: 'c:foreign', label: 'Mostra sulla mappa' },
  };
}

function quakeInsight(input: NonNullable<InsightInput['quake']>, provinces: Unit[]): Insight | null {
  const ps = provinces.filter(p => p.v.quakeRate != null && p.pop > 0);
  if (ps.length < 3) return null;
  const rates = ps.map(p => p.v.quakeRate!);
  const med = median(rates);
  const totalPop = ps.reduce((s, p) => s + p.pop, 0);
  const exposed = ps.filter(p => p.v.quakeRate! > med).reduce((s, p) => s + p.pop, 0);
  const top = [...ps].sort((a, b) => b.v.quakeRate! - a.v.quakeRate!).slice(0, 3);
  const w = wmean(rates, ps.map(p => p.pop));
  return {
    id: 'quake-exposure',
    group: 'rischi',
    title: 'Sismicità e popolazione',
    text: `Dal ${input.fromYear} l'INGV ha registrato ${fmt(input.total)} terremoti M3+ nell'area italiana. Le province con più eventi per 1.000 km² sono ${top.map(p => `${p.name} (${fmt(p.v.quakeRate!, 1)})`).join(', ')}. Il ${fmt((exposed / totalPop) * 100)}% della popolazione vive in province con una densità di eventi sopra la mediana (${fmt(med, 1)}); in media ponderata per abitanti ${fmt(w, 1)}. Il catalogo è più completo per gli anni recenti e le sequenze con molte repliche (come quella del Centro Italia 2016–17) gonfiano i conteggi delle province coinvolte: i numeri vanno letti come confronto tra province, non come serie storica.`,
    tone: 'warn',
    facts: [`n = ${fmt(ps.length)} province`],
    action: { kind: 'plot', level: 'province', x: 'quakeRate', y: 'density', label: 'Apri il grafico' },
  };
}

function climateInsight(regions: Unit[]): Insight | null {
  const rs = regions.filter(r => r.v.tempTrend != null && r.v.tempMean != null);
  if (rs.length < 5) return null;
  const trends = rs.map(r => r.v.tempTrend!);
  const warming = trends.filter(t => t > 0).length;
  const hot = rs.reduce((m, r) => (r.v.tempMean! > m.v.tempMean! ? r : m));
  const cold = rs.reduce((m, r) => (r.v.tempMean! < m.v.tempMean! ? r : m));
  const fast = rs.reduce((m, r) => (r.v.tempTrend! > m.v.tempTrend! ? r : m));
  const slow = rs.reduce((m, r) => (r.v.tempTrend! < m.v.tempTrend! ? r : m));
  return {
    id: 'climate',
    group: 'rischi',
    title: 'Il clima negli ultimi trent\'anni',
    text: `In ${warming} regioni su ${rs.length} la temperatura media annua è in aumento dal 1991, in media di ${fmt(mean(trends), 2)} °C per decennio (da ${fmt(slow.v.tempTrend!, 2)} in ${slow.name} a ${fmt(fast.v.tempTrend!, 2)} in ${fast.name}). La media annua va da ${fmt(cold.v.tempMean!, 1)} °C (${cold.name}) a ${fmt(hot.v.tempMean!, 1)} °C (${hot.name}). Sono i dati di una griglia di circa 50 km sul capoluogo, non una media regionale: in montagna la temperatura risulta più bassa di quella del fondovalle.`,
    tone: warming === rs.length ? 'warn' : 'info',
    facts: [`n = ${rs.length} regioni`, 'fonte: NASA POWER'],
    action: { kind: 'plot', level: 'region', x: 'tempMean', y: 'inc', label: 'Apri il grafico' },
  };
}

function alertInsight(a: NonNullable<InsightInput['alerts']>): Insight {
  const e = a.exposure;
  const inAlert = (arr: AlertCounts, from: number) => arr.slice(from).reduce((s, v) => s + v, 0);
  const popAll = e.pop.reduce((s, v) => s + v, 0);
  const yellowUp = inAlert(e.comuni, 1);
  const orangeUp = inAlert(e.comuni, 2);
  const none = yellowUp === 0;
  let text: string;
  if (none) {
    text = `Oggi nessun comune è in allerta meteo-idro (${a.title ?? 'bollettino DPC'}).`;
  } else {
    text = `Oggi ${fmt(yellowUp)} comuni (${fmt((inAlert(e.pop, 1) / popAll) * 100)}% della popolazione) sono in allerta gialla o superiore; in arancione o rossa ${fmt(orangeUp)} comuni, dove vivono ${fmt(inAlert(e.pop, 2))} persone, di cui circa ${fmt(Math.round(inAlert(e.over65, 2) / 1000) * 1000)} over 65.`;
  }
  return {
    id: 'alerts-today',
    group: 'rischi',
    title: 'Allerte di oggi e popolazione esposta',
    text,
    tone: none ? 'good' : orangeUp ? 'warn' : 'info',
    facts: [`gialla ${fmt(e.comuni[1])}`, `arancione ${fmt(e.comuni[2])}`, `rossa ${fmt(e.comuni[3])}`, a.title ?? 'bollettino DPC'],
    action: { kind: 'map', choro: 'c:alert', label: 'Mostra sulla mappa' },
  };
}

/** Tutte le conclusioni disponibili con i dati caricati, in ordine: divari, demografia, relazioni, rischi. */
export function buildInsights(input: InsightInput): Insight[] {
  const { comuni, units } = input;
  if (comuni.length < 30) return [];
  const areas = areaTable(comuni);
  const sizes = sizeTable(comuni);
  const italy = aggregate(comuni);

  const out: (Insight | null)[] = [
    incomeGap(areas, units.province),
    incomeTrend(comuni),
    foreignDistribution(areas),
    shrinking(comuni, sizes),
    ageing(units.province, italy),
  ];

  // le coppie con dati non ancora caricati (sismicità, clima) non producono nulla finché mancano
  const rels = PAIRS.map(p => relationInsight(p.level, p.x, p.y, units[p.level]))
    .filter((i): i is Insight => i !== null)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  out.push(...rels);

  if (input.quake) out.push(quakeInsight(input.quake, units.province));
  out.push(climateInsight(units.region));
  if (input.alerts) out.push(alertInsight(input.alerts));
  return out.filter((i): i is Insight => i !== null);
}
