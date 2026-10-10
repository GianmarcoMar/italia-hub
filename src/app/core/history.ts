/**
 * Conversione delle risposte delle fonti storiche e di contesto: clima mensile NASA POWER,
 * catalogo sismico INGV in formato testo, Wikidata, Overpass (OSM). Funzioni pure, test in history.spec.ts.
 */
import { parseUtc } from './parsers';

// ---------- clima (NASA POWER, medie mensili) ----------

export interface ClimateYear {
  year: number;
  /** temperatura media annua, °C */
  t: number;
  /** precipitazione totale annua, mm */
  p: number;
}

export interface Climate {
  years: ClimateYear[];
  /** normali mensili 1991-2020: temperatura media (°C) e pioggia (mm/mese) */
  normals: { month: number; t: number; p: number }[];
  /** tendenza lineare della temperatura, °C per decennio */
  trendPerDecade: number | null;
}

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Risposta POWER "monthly": parametri T2M (°C) e PRECTOTCORR (mm/giorno) con chiavi "YYYYMM";
 * il mese 13 è la media annua e -999 indica dato mancante.
 */
export function parsePower(r: any): Climate | null {
  const P = r?.properties?.parameter;
  const T2M: Record<string, number> = P?.T2M ?? {};
  const PR: Record<string, number> = P?.PRECTOTCORR ?? {};
  const byYear = new Map<number, { t: number[]; p: number[] }>();
  for (const [k, t] of Object.entries(T2M)) {
    const y = +k.slice(0, 4);
    const m = +k.slice(4);
    if (m < 1 || m > 12 || t === -999) continue;
    const pr = PR[k];
    const e = byYear.get(y) ?? { t: [], p: [] };
    e.t[m - 1] = t;
    e.p[m - 1] = pr === undefined || pr === -999 ? NaN : pr * DAYS[m - 1];
    byYear.set(y, e);
  }
  const years: ClimateYear[] = [...byYear.entries()]
    .filter(([, e]) => e.t.filter(Number.isFinite).length === 12)
    .map(([year, e]) => ({
      year,
      t: e.t.reduce((a, b) => a + b, 0) / 12,
      p: e.p.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    }))
    .sort((a, b) => a.year - b.year);
  if (!years.length) return null;

  const normals = Array.from({ length: 12 }, (_, i) => {
    const sel = [...byYear.entries()].filter(([y]) => y >= 1991 && y <= 2020).map(([, e]) => e);
    const ts = sel.map(e => e.t[i]).filter(Number.isFinite);
    const ps = sel.map(e => e.p[i]).filter(Number.isFinite);
    return { month: i + 1, t: avg(ts), p: avg(ps) };
  });
  return { years, normals, trendPerDecade: slope(years.map(y => [y.year, y.t])) * 10 };
}

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** Pendenza della retta dei minimi quadrati. */
export function slope(points: [number, number][]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const num = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const den = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return den ? num / den : 0;
}

// ---------- sismicità storica (INGV, format=text) ----------

export interface HistQuake {
  id: string;
  time: number;
  lat: number;
  lon: number;
  depthKm: number;
  mag: number;
  place: string;
}

/** Righe "EventID|Time|Latitude|Longitude|Depth/Km|…|MagType|Magnitude|MagAuthor|EventLocationName|EventType". */
export function parseIngvText(text: string | null): HistQuake[] {
  if (!text) return []; // 204: nessun evento
  const out: HistQuake[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('|');
    if (c.length < 13) continue;
    const q = {
      id: c[0],
      time: parseUtc(c[1]),
      lat: +c[2],
      lon: +c[3],
      depthKm: +c[4],
      mag: +c[10],
      place: c[12],
    };
    if (Number.isFinite(q.time) && Number.isFinite(q.mag)) out.push(q);
  }
  return out;
}

/** Eventi per anno, dal primo all'ultimo anno indicati (anni vuoti inclusi). */
export function perYear(list: { time: number }[], from: number, to: number): { year: number; n: number }[] {
  const counts = new Map<number, number>();
  for (const q of list) {
    const y = new Date(q.time).getUTCFullYear();
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, n: counts.get(from + i) ?? 0 }));
}

// ---------- Wikidata ----------

export interface WikiFacts {
  item: string | null;
  label: string | null;
  /** titolo della voce su it.wikipedia */
  title: string | null;
  elevation: number | null;
  postcodes: string | null;
  website: string | null;
  mayor: string | null;
  patron: string | null;
  demonym: string | null;
}

/** Prima riga dei risultati SPARQL (query raggruppata per elemento). */
export function parseWikiFacts(r: any): WikiFacts | null {
  const b = r?.results?.bindings?.[0];
  if (!b) return null;
  const v = (k: string) => (b[k]?.value as string | undefined) ?? null;
  const elev = v('elevation');
  const site = v('website');
  return {
    item: v('item'),
    label: v('label'),
    title: v('title'),
    elevation: elev !== null && Number.isFinite(+elev) ? Math.round(+elev) : null,
    postcodes: v('posts') || null,
    // solo link http(s): il valore arriva da dati esterni
    website: site && /^https?:\/\//i.test(site) ? site : null,
    mayor: v('mayor'),
    patron: v('patron'),
    demonym: v('demonym'),
  };
}

// ---------- OSM (Overpass, "out count") ----------

/** Un elemento "count" per ogni categoria, nello stesso ordine della query. */
export function parseOverpassCounts(r: any): number[] {
  return (r?.elements ?? []).filter((e: any) => e.type === 'count').map((e: any) => Number(e.tags?.total ?? 0));
}
