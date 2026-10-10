/**
 * Conversione delle risposte grezze delle API nei modelli dell'app.
 * Funzioni pure, senza Angular: si testano senza TestBed (vedi parsers.spec.ts).
 * Formati verificati contro le API vere a ottobre 2026.
 */

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  /** Nome inglese (da OpenStreetMap), per cercare nelle collezioni internazionali. */
  nameEn?: string;
}

export interface Forecast {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: number[];
  };
}

export interface NowWeather {
  temp: number;
  code: number;
}

/** Qualità dell'aria attuale (Open-Meteo, modello CAMS Europa). */
export interface AirQuality {
  aqi: number | null;
  pm2_5: number | null;
  pm10: number | null;
  no2: number | null;
  o3: number | null;
  so2: number | null;
  /** pollini, granuli/m³ (null fuori stagione o fuori Europa) */
  pollen: { name: string; value: number }[];
  /** EAQI nelle 24 ore passate e nelle 24 future */
  hourly: { time: string; aqi: number | null }[];
}

export interface Marine {
  wave: number | null;
  period: number | null;
  sst: number | null;
  /** cella di mare usata dal modello (per i punti sulla costa è spostata in mare) */
  lat: number;
  lon: number;
}

/** Fasce dell'indice europeo di qualità dell'aria (EAQI). */
export const AQI_BANDS = [
  { max: 20, label: 'Buona', color: '#50f0e6' },
  { max: 40, label: 'Discreta', color: '#50ccaa' },
  { max: 60, label: 'Moderata', color: '#f0e641' },
  { max: 80, label: 'Scadente', color: '#ff5050' },
  { max: 100, label: 'Molto scadente', color: '#960032' },
  { max: Infinity, label: 'Pessima', color: '#7d2181' },
];

export const aqiBand = (v: number | null) => (v === null ? null : AQI_BANDS.find(b => v <= b.max)!);

const POLLEN: Record<string, string> = {
  alder_pollen: 'Ontano',
  birch_pollen: 'Betulla',
  grass_pollen: 'Graminacee',
  mugwort_pollen: 'Artemisia',
  olive_pollen: 'Olivo',
  ragweed_pollen: 'Ambrosia',
};
export const POLLEN_VARS = Object.keys(POLLEN);

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toAirQuality(r: any): AirQuality {
  const c = r?.current ?? {};
  const h = r?.hourly ?? {};
  return {
    aqi: numOrNull(c.european_aqi),
    pm2_5: numOrNull(c.pm2_5),
    pm10: numOrNull(c.pm10),
    no2: numOrNull(c.nitrogen_dioxide),
    o3: numOrNull(c.ozone),
    so2: numOrNull(c.sulphur_dioxide),
    pollen: POLLEN_VARS.map(k => ({ name: POLLEN[k], value: numOrNull(c[k]) ?? 0 })).filter(p => p.value >= 1),
    hourly: (h.time ?? []).map((time: string, i: number) => ({ time, aqi: numOrNull(h.european_aqi?.[i]) })),
  };
}

export function toMarine(r: any): Marine | null {
  const c = r?.current ?? {};
  const m = {
    wave: numOrNull(c.wave_height),
    period: numOrNull(c.wave_period),
    sst: numOrNull(c.sea_surface_temperature),
    lat: Number(r?.latitude),
    lon: Number(r?.longitude),
  };
  // nell'entroterra il modello marino non ha dati
  return m.wave === null && m.sst === null ? null : m;
}

/** EAQI attuale di più punti (stesso ordine). */
export const toAqiMany = (r: unknown): (number | null)[] => (Array.isArray(r) ? r : [r]).map((x: any) => numOrNull(x?.current?.european_aqi));

export interface Quake {
  id: string;
  mag: number;
  place: string;
  time: number; // ms epoch, UTC
  lat: number;
  lon: number;
  depthKm: number | null;
  url?: string;
}

export interface DatasetHit {
  id: string;
  title: string;
  notes: string;
  org: string;
  formats: string[];
  url: string;
}

// ---------- Open-Meteo geocoding ----------
export function toPlace(x: any): Place {
  return {
    name: String(x.name),
    detail: [x.admin1, x.country].filter(Boolean).join(', '),
    lat: Number(x.latitude),
    lon: Number(x.longitude),
  };
}

/**
 * Geocoding inverso di Nominatim (OpenStreetMap). Ritorna null se il punto non ha un indirizzo
 * (es. in mare: Nominatim risponde { error: "Unable to geocode" }).
 */
export function toReversePlace(r: any, lat: number, lon: number): Place | null {
  if (!r || r.error || !r.address) return null;
  const a = r.address;
  // in mare vicino alla costa Nominatim risponde con il paese o la regione: non è un luogo utile
  const broad = ['country', 'state', 'region', 'continent'].includes(r.addresstype);
  const name = a.city || a.town || a.village || a.municipality || a.hamlet || (broad ? null : r.name);
  if (!name) return null;
  const nd = r.namedetails ?? {};
  return {
    name: String(name),
    detail: [a.county && a.county !== name ? a.county : null, a.state, a.country].filter(Boolean).join(', '),
    lat,
    lon,
    nameEn: nd['name:en'] || nd['name'] || String(name),
  };
}

/** Open-Meteo con più coordinate risponde con un array, con una sola con un oggetto. */
export function toNowWeather(r: unknown): NowWeather[] {
  const list = Array.isArray(r) ? r : [r];
  return list.map((x: any) => ({
    temp: Number(x?.current?.temperature_2m),
    code: Number(x?.current?.weather_code),
  }));
}

export function isPlace(v: unknown): v is Place {
  const p = v as Place;
  return (
    !!p &&
    typeof p.name === 'string' &&
    typeof p.detail === 'string' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon)
  );
}

// ---------- Terremoti (FDSN geojson) ----------

/**
 * Tempo in ms. USGS manda già ms epoch; INGV manda ISO in UTC ma senza fuso
 * (es. "2026-10-08T13:39:40.410000"), che Date.parse leggerebbe come ora locale.
 */
export function parseUtc(t: unknown): number {
  if (typeof t === 'number') return t;
  if (typeof t !== 'string' || !t) return NaN;
  const trimmed = t.trim().replace(/(\.\d{3})\d+/, '$1'); // millisecondi a 3 cifre
  const hasZone = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(trimmed);
  return Date.parse(hasZone ? trimmed : trimmed + 'Z');
}

/** Converte una feature geojson INGV o USGS. Ritorna null se mancano le coordinate. */
function toQuake(f: any): Quake | null {
  const p = f?.properties ?? {};
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const [lon, lat, depth] = c;
  const time = parseUtc(p.time);
  return {
    id: String(f.id ?? p.eventId ?? `${lat},${lon},${p.time}`),
    mag: Number(p.mag ?? 0),
    place: String(p.place ?? '—'),
    time,
    lat,
    lon,
    depthKm: Number.isFinite(depth) ? Math.abs(depth) : null,
    url: typeof p.url === 'string' ? p.url : undefined,
  };
}

/** INGV risponde 204 senza corpo quando non trova eventi: HttpClient dà null. */
export function toQuakes(r: { features?: unknown[] } | null): Quake[] {
  return (r?.features ?? []).map(toQuake).filter((q): q is Quake => q !== null);
}

// ---------- dati.gov.it (CKAN) ----------

/** I campi CKAN possono essere stringhe o oggetti multilingua ({ it, en, ... }). */
export function ckanText(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const s = o['it'] ?? Object.values(o).find(x => typeof x === 'string' && x);
    return typeof s === 'string' ? s : '';
  }
  return String(v);
}

export function toDataset(d: any): DatasetHit {
  const formats = (d.resources ?? []).map((x: any) => String(x.format || '').toUpperCase()).filter(Boolean);
  return {
    id: String(d.id),
    title: ckanText(d.title) || String(d.name ?? ''),
    notes: ckanText(d.notes),
    org: ckanText(d.organization?.title) || '—',
    formats: [...new Set<string>(formats)],
    url: `https://www.dati.gov.it/view-dataset/dataset?id=${encodeURIComponent(d.id)}`,
  };
}

// ---------- Geometria ----------
type Ring = number[][];

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Punto dentro un Polygon o MultiPolygon GeoJSON (i buchi sono gestiti). */
export function containsPoint(geometry: { type: string; coordinates: any } | null, lat: number, lon: number): boolean {
  if (!geometry) return false;
  const polys: Ring[][] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some(h => inRing(lon, lat, h)));
}
