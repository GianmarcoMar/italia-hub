/**
 * Funzioni pure per le analisi della console: tempo, aggregazioni, allerte, classi della coropleta
 * e stato nell'URL. Niente Angular, testate in analysis.spec.ts.
 */
import { NowWeather, Quake } from './parsers';

export type TimeWindow = [from: number, to: number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Distanza in km tra due punti (formula dell'emisenoverso). */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ---------- tempo ----------

/** Ampiezza delle barre della timeline: ~24-30 barre qualunque sia il periodo. */
export function binSize(spanMs: number): number {
  if (spanMs <= 2 * DAY) return HOUR;
  if (spanMs <= 10 * DAY) return 6 * HOUR;
  return DAY;
}

export interface Bin {
  from: number;
  to: number;
  count: number;
  maxMag: number;
}

/** Istogramma degli eventi in [from, to), barre allineate all'ora/giorno. */
export function binEvents(events: { time: number; mag: number }[], from: number, to: number, size = binSize(to - from)): Bin[] {
  const start = Math.floor(from / size) * size;
  const n = Math.max(1, Math.ceil((to - start) / size));
  const bins: Bin[] = Array.from({ length: n }, (_, i) => ({ from: start + i * size, to: start + (i + 1) * size, count: 0, maxMag: 0 }));
  for (const e of events) {
    const i = Math.floor((e.time - start) / size);
    if (i < 0 || i >= n) continue;
    bins[i].count++;
    bins[i].maxMag = Math.max(bins[i].maxMag, e.mag);
  }
  return bins;
}

export function inWindow<T extends { time: number }>(list: T[], w: TimeWindow | null): T[] {
  if (!w) return list;
  const [a, b] = w[0] <= w[1] ? w : [w[1], w[0]];
  return list.filter(x => x.time >= a && x.time <= b);
}

// ---------- relazioni ----------

/** Eventi entro `radiusKm` e `hours` ore da q (escluso q), dal più vicino. */
export function relatedQuakes(q: Quake, list: Quake[], radiusKm = 30, hours = 48): (Quake & { distKm: number })[] {
  return list
    .filter(o => o.id !== q.id && Math.abs(o.time - q.time) <= hours * HOUR)
    .map(o => ({ ...o, distKm: km(q, o) }))
    .filter(o => o.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm);
}

/** Conteggio e magnitudo massima per regione. `regionOf` ritorna il codice ISTAT o null. */
export function countByRegion(
  list: { lat: number; lon: number; mag: number }[],
  regionOf: (lat: number, lon: number) => number | null,
): Map<number, { count: number; maxMag: number }> {
  const out = new Map<number, { count: number; maxMag: number }>();
  for (const q of list) {
    const code = regionOf(q.lat, q.lon);
    if (code === null) continue;
    const cur = out.get(code) ?? { count: 0, maxMag: 0 };
    cur.count++;
    cur.maxMag = Math.max(cur.maxMag, q.mag);
    out.set(code, cur);
  }
  return out;
}

// ---------- allerte meteo ----------

export interface WeatherAlert {
  key: string;
  level: 'warn' | 'alarm';
  label: string;
}

/** Allerte derivate dal meteo attuale: temporali (≥95) = allarme, rovesci violenti o neve forte = attenzione. */
export function weatherAlert(now: NowWeather | null): WeatherAlert | null {
  if (!now || !Number.isFinite(now.code)) return null;
  const c = now.code;
  if (c >= 95) return { key: `t${c}`, level: 'alarm', label: c === 95 ? 'Temporale in corso' : 'Temporale con grandine' };
  if (c === 82) return { key: 'r82', level: 'warn', label: 'Rovesci violenti' };
  if (c === 75 || c === 86) return { key: `s${c}`, level: 'warn', label: 'Neve forte' };
  if (c === 65) return { key: 'p65', level: 'warn', label: 'Pioggia forte' };
  if (Number.isFinite(now.temp) && now.temp >= 35) return { key: 'h', level: 'warn', label: 'Caldo intenso' };
  return null;
}

// ---------- coropleta ----------

export interface Step {
  min: number;
  color: string;
  label: string;
}

export const QUAKE_STEPS: Step[] = [
  { min: 1, color: '#134e4a', label: '1' },
  { min: 3, color: '#0f766e', label: '3' },
  { min: 10, color: '#14b8a6', label: '10' },
  { min: 30, color: '#5eead4', label: '30+' },
];

export const TEMP_STEPS: Step[] = [
  { min: -Infinity, color: '#2563eb', label: '< 5°' },
  { min: 5, color: '#38bdf8', label: '5–12' },
  { min: 12, color: '#a3e635', label: '12–18' },
  { min: 18, color: '#f5a524', label: '18–24' },
  { min: 24, color: '#f97316', label: '24–30' },
  { min: 30, color: '#ef4444', label: '> 30°' },
];

/** Colore della classe in cui cade v (null se sotto la prima soglia). */
export function stepColor(v: number | null | undefined, steps: Step[]): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  let color: string | null = null;
  for (const s of steps) if (v >= s.min) color = s.color;
  return color;
}

// ---------- stato nell'URL ----------

/**
 * Coropleta attiva:
 * - regioni: 'quakes' (eventi nella finestra), 'temp' (capoluogo)
 * - province, in tempo reale: 'p:aqi' (qualità dell'aria), 'p:temp'
 * - comuni: 'c:<indicatore>' (vedi COMUNE_METRICS) e 'c:alert' / 'c:alert2' (allerta DPC oggi/domani)
 */
export type Choropleth = 'none' | 'quakes' | 'temp' | 'p:aqi' | 'p:temp' | `c:${string}`;

const CHORO = /^(quakes|temp|p:aqi|p:temp|c:[a-zA-Z0-9]+)$/;

/** Entità selezionabili, come stanno nell'URL. */
export type SelState =
  | { kind: 'quake'; id: string }
  | { kind: 'region'; code: number }
  | { kind: 'province'; code: number }
  | { kind: 'comune'; code: string }
  | { kind: 'italy' };

export interface ViewState {
  lat?: number;
  lon?: number;
  z?: number;
  window?: TimeWindow;
  source?: 'ingv' | 'usgs';
  days?: number;
  minMag?: number;
  choro?: Choropleth;
  sel?: SelState;
}

const num = (v: string | undefined | null) => (v != null && v !== '' && Number.isFinite(+v) ? +v : undefined);

/** Legge lo stato dai query param, ignorando valori non validi. */
export function parseView(p: Record<string, string | undefined>): ViewState {
  const s: ViewState = {};
  const lat = num(p['lat']);
  const lon = num(p['lon']);
  if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) Object.assign(s, { lat, lon });
  const z = num(p['z']);
  if (z !== undefined && z >= 3 && z <= 18) s.z = Math.round(z);
  const t0 = num(p['t0']);
  const t1 = num(p['t1']);
  if (t0 !== undefined && t1 !== undefined && t1 > t0) s.window = [t0, t1];
  if (p['src'] === 'ingv' || p['src'] === 'usgs') s.source = p['src'];
  const d = num(p['d']);
  if (d === 1 || d === 7 || d === 30) s.days = d;
  const m = num(p['m']);
  if (m !== undefined && [1, 2, 3, 4.5].includes(m)) s.minMag = m;
  if (p['ch'] && CHORO.test(p['ch'])) s.choro = p['ch'] as Choropleth;
  s.sel = parseSel(p['sel'] ?? '');
  if (!s.sel) delete s.sel;
  return s;
}

function parseSel(sel: string): SelState | undefined {
  if (sel === 'it') return { kind: 'italy' };
  const [kind, v] = [sel.slice(0, 2), sel.slice(2)];
  if (kind === 'q:' && /^[\w.-]{1,40}$/.test(v)) return { kind: 'quake', id: v };
  if (kind === 'c:' && /^[A-Z]\d{3}$/.test(v)) return { kind: 'comune', code: v };
  const n = num(v);
  if (kind === 'r:' && n !== undefined && n >= 1 && n <= 20) return { kind: 'region', code: n };
  if (kind === 'p:' && n !== undefined && n >= 1 && n <= 999) return { kind: 'province', code: n };
  return undefined;
}

function serializeSel(s: SelState): string {
  switch (s.kind) {
    case 'quake':
      return `q:${s.id}`;
    case 'region':
      return `r:${s.code}`;
    case 'province':
      return `p:${s.code}`;
    case 'comune':
      return `c:${s.code}`;
    case 'italy':
      return 'it';
  }
}

/** Scrive solo ciò che differisce dai default, così gli URL restano corti. */
export function serializeView(s: ViewState): Record<string, string | null> {
  const fix = (v: number, d: number) => String(Math.round(v * 10 ** d) / 10 ** d);
  return {
    lat: s.lat !== undefined ? fix(s.lat, 4) : null,
    lon: s.lon !== undefined ? fix(s.lon, 4) : null,
    z: s.z !== undefined ? String(s.z) : null,
    t0: s.window ? String(Math.round(s.window[0])) : null,
    t1: s.window ? String(Math.round(s.window[1])) : null,
    src: s.source && s.source !== 'ingv' ? s.source : null,
    d: s.days && s.days !== 7 ? String(s.days) : null,
    m: s.minMag !== undefined && s.minMag !== 2 ? String(s.minMag) : null,
    ch: s.choro && s.choro !== 'none' ? s.choro : null,
    sel: s.sel ? serializeSel(s.sel) : null,
  };
}
