import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, retry, switchMap, tap, throwError, timeout, timer } from 'rxjs';
import type { Topology } from 'topojson-specification';
import { AlertZone, latestBulletinId, zonesFromTopo } from './alerts';
import { Climate, HistQuake, WikiFacts, parseIngvText, parseOverpassCounts, parsePower, parseWikiFacts } from './history';
import {
  AirQuality,
  Marine,
  POLLEN_VARS,
  toAirQuality,
  toAqiMany,
  toMarine,
} from './parsers';
import {
  DatasetHit,
  Forecast,
  NowWeather,
  Place,
  Quake,
  toDataset,
  toNowWeather,
  toPlace,
  toQuakes,
  toReversePlace,
} from './parsers';

export type { DatasetHit, Forecast, NowWeather, Place, Quake, SeriesPoint } from './parsers';

/**
 * Tutte le chiamate alle API pubbliche in un solo posto. Nessuna chiave richiesta.
 * CORS verificato a ottobre 2026: tutte mandano Access-Control-Allow-Origin: *
 * tranne dati.gov.it, che si interroga via JSONP (supportato da CKAN).
 */

export type QuakeSource = 'ingv' | 'usgs';

export interface QuakeQuery {
  source: QuakeSource;
  days: number;
  minMag: number;
  /** Se presente, filtra lato server per distanza dal punto. */
  near: { lat: number; lon: number; radiusKm: number } | null;
}

/** Massimo di eventi chiesti per richiesta. */
export const QUAKE_LIMIT = 500;

/** Riquadro dell'Italia: il catalogo INGV contiene anche i grandi terremoti nel mondo. */
const ITALY_BBOX = { minlatitude: 35, maxlatitude: 48, minlongitude: 6, maxlongitude: 19 };

const FDSN = {
  ingv: 'https://webservices.ingv.it/fdsnws/event/1/query',
  usgs: 'https://earthquake.usgs.gov/fdsnws/event/1/query',
};


const DPC_RAW = 'https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master';

export interface DpcBulletin {
  name: string;
  date: string;
  today: { topo_json: string; html_descrition: string };
  tomorrow: { topo_json: string; html_descrition: string };
}

/**
 * Cache in localStorage per dati che cambiano di rado (clima storico, fatti Wikidata): meno richieste
 * a servizi con limiti stretti. Se lo storage non è disponibile si va semplicemente in rete.
 */
function cachedLocal<T>(key: string, ttlMs: number, source: Observable<T>): Observable<T> {
  const k = `italia-hub:cache:${key}`;
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const { at, v } = JSON.parse(raw) as { at: number; v: T };
      if (Date.now() - at < ttlMs) return of(v);
    }
  } catch {
    /* storage non disponibile o valore corrotto */
  }
  return source.pipe(
    tap(v => {
      try {
        if (v !== null && v !== undefined) localStorage.setItem(k, JSON.stringify({ at: Date.now(), v }));
      } catch {
        /* quota piena: pazienza */
      }
    }),
  );
}

const DAY_MS = 86_400_000;

/**
 * Riprova le richieste fallite per errori temporanei (rete o 5xx: Open-Meteo e World Bank
 * ogni tanto rispondono 503). Mai sui 4xx, compreso il 429 dei limiti di frequenza.
 */
function retryTransient<T>() {
  return retry<T>({
    count: 2,
    delay: (err, attempt) => {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status !== 0 && status < 500) return throwError(() => err);
      return timer(attempt * 800);
    },
  });
}

@Injectable({ providedIn: 'root' })
export class ApisService {
  private http = inject(HttpClient);

  // ---------- Open-Meteo (CC BY 4.0, gratis solo non commerciale) ----------
  geocode(query: string): Observable<Place[]> {
    const params = new HttpParams().set('name', query).set('count', 8).set('language', 'it').set('format', 'json');
    return this.http
      .get<{ results?: unknown[] }>('https://geocoding-api.open-meteo.com/v1/search', { params })
      .pipe(retryTransient(), map(r => (r.results ?? []).map(toPlace)));
  }

  forecast(lat: number, lon: number): Observable<Forecast> {
    const params = new HttpParams()
      .set('latitude', lat)
      .set('longitude', lon)
      .set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code')
      .set('hourly', 'temperature_2m,precipitation_probability')
      .set('forecast_hours', 24) // dall'ora corrente
      .set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max')
      .set('timezone', 'Europe/Rome')
      .set('forecast_days', 7);
    return this.http.get<Forecast>('https://api.open-meteo.com/v1/forecast', { params }).pipe(retryTransient());
  }

  /** Meteo attuale di più punti in una sola richiesta (stesso ordine dei punti). */
  nowWeather(points: { lat: number; lon: number }[]): Observable<NowWeather[]> {
    const params = new HttpParams()
      .set('latitude', points.map(p => p.lat).join(','))
      .set('longitude', points.map(p => p.lon).join(','))
      .set('current', 'temperature_2m,weather_code')
      .set('timezone', 'Europe/Rome');
    return this.http
      .get<unknown>('https://api.open-meteo.com/v1/forecast', { params })
      .pipe(retryTransient(), map(toNowWeather));
  }

  // ---------- Open-Meteo qualità dell'aria (CAMS) e mare ----------

  /** Qualità dell'aria attuale, pollini ed EAQI orario nelle 24 ore passate e future. */
  airQuality(lat: number, lon: number): Observable<AirQuality> {
    const params = new HttpParams()
      .set('latitude', lat)
      .set('longitude', lon)
      .set('current', ['european_aqi', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide', ...POLLEN_VARS].join(','))
      .set('hourly', 'european_aqi')
      .set('past_hours', 24)
      .set('forecast_hours', 24)
      .set('timezone', 'Europe/Rome');
    return this.http
      .get<unknown>('https://air-quality-api.open-meteo.com/v1/air-quality', { params })
      .pipe(retryTransient(), map(toAirQuality));
  }

  /** EAQI attuale di più punti in una richiesta (ogni punto conta come una chiamata nella quota). */
  aqiMany(points: { lat: number; lon: number }[]): Observable<(number | null)[]> {
    const params = new HttpParams()
      .set('latitude', points.map(p => p.lat).join(','))
      .set('longitude', points.map(p => p.lon).join(','))
      .set('current', 'european_aqi');
    return this.http
      .get<unknown>('https://air-quality-api.open-meteo.com/v1/air-quality', { params })
      .pipe(retryTransient(), map(toAqiMany));
  }

  /** Onde e temperatura del mare; null nell'entroterra. */
  marine(lat: number, lon: number): Observable<Marine | null> {
    const params = new HttpParams()
      .set('latitude', lat)
      .set('longitude', lon)
      .set('current', 'wave_height,wave_period,sea_surface_temperature');
    return this.http.get<unknown>('https://marine-api.open-meteo.com/v1/marine', { params }).pipe(
      map(toMarine),
      catchError(() => of(null)),
    );
  }

  // ---------- NASA POWER: clima mensile dal 1991 (dati pubblici NASA) ----------
  climate(lat: number, lon: number): Observable<Climate | null> {
    const end = new Date().getFullYear() - 1;
    const params = new HttpParams()
      .set('parameters', 'T2M,PRECTOTCORR')
      .set('community', 'RE')
      .set('latitude', lat.toFixed(3))
      .set('longitude', lon.toFixed(3))
      .set('start', 1991)
      .set('end', end)
      .set('format', 'JSON');
    return cachedLocal(
      `power:${lat.toFixed(1)},${lon.toFixed(1)}:${end}`,
      30 * DAY_MS,
      this.http
        .get<unknown>('https://power.larc.nasa.gov/api/temporal/monthly/point', { params })
        .pipe(timeout(30_000), retryTransient(), map(parsePower)),
    );
  }

  // ---------- INGV: catalogo storico dal 1985 (formato testo, più leggero del geojson) ----------
  quakeHistory(area: { lat: number; lon: number; radiusKm: number } | { box: [number, number, number, number] }, minMag: number): Observable<HistQuake[]> {
    let params = new HttpParams()
      .set('starttime', '1985-01-01')
      .set('minmagnitude', minMag)
      .set('orderby', 'time')
      .set('limit', 20000)
      .set('format', 'text');
    if ('box' in area) {
      const [s, w, n, e] = area.box;
      params = params.set('minlatitude', s).set('minlongitude', w).set('maxlatitude', n).set('maxlongitude', e);
    } else {
      params = params.set('latitude', area.lat).set('longitude', area.lon).set('maxradiuskm', area.radiusKm);
    }
    return this.http
      .get(FDSN.ingv, { params, responseType: 'text' })
      .pipe(timeout(45_000), retryTransient(), map(parseIngvText));
  }

  // ---------- Wikidata (CC0) e Wikipedia (CC BY-SA) ----------

  /** Fatti sul comune dal codice catastale; solo elementi con codice ISTAT (esclude le frazioni). */
  wikiFacts(catasto: string): Observable<WikiFacts | null> {
    if (!/^[A-Z]\d{3}$/.test(catasto)) return of(null);
    const query = `SELECT ?item ?label ?title (SAMPLE(?elev) AS ?elevation) (GROUP_CONCAT(DISTINCT ?post; separator=", ") AS ?posts)
      (SAMPLE(?site) AS ?website) (SAMPLE(?mayorName) AS ?mayor) (SAMPLE(?patronName) AS ?patron) (SAMPLE(?dem) AS ?demonym) WHERE {
      ?item wdt:P806 "${catasto}" ; wdt:P635 ?istat .
      OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "it") }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://it.wikipedia.org/> ; schema:name ?title }
      OPTIONAL { ?item wdt:P2044 ?elev }
      OPTIONAL { ?item wdt:P281 ?post }
      OPTIONAL { ?item wdt:P856 ?site }
      OPTIONAL { ?item p:P6 ?ms . ?ms ps:P6 ?mayorItem . FILTER NOT EXISTS { ?ms pq:P582 ?end } ?mayorItem rdfs:label ?mayorName FILTER(LANG(?mayorName) = "it") }
      OPTIONAL { ?item wdt:P417 ?patronItem . ?patronItem rdfs:label ?patronName FILTER(LANG(?patronName) = "it") }
      OPTIONAL { ?item wdt:P1549 ?dem FILTER(LANG(?dem) = "it") }
    } GROUP BY ?item ?label ?title LIMIT 1`;
    const params = new HttpParams().set('format', 'json').set('query', query);
    // il servizio SPARQL limita le richieste (429): risultati tenuti una settimana, errori visibili
    return cachedLocal(
      `wd:${catasto}`,
      7 * DAY_MS,
      this.http.get<unknown>('https://query.wikidata.org/sparql', { params }).pipe(timeout(20_000), map(parseWikiFacts)),
    );
  }

  /** Riassunto della voce di it.wikipedia: testo semplice, immagine e link. */
  wikiSummary(title: string): Observable<{ extract: string; thumb: string | null; url: string } | null> {
    return this.http.get<any>(`https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`).pipe(
      map(r =>
        r?.extract
          ? {
              extract: String(r.extract),
              thumb: typeof r.thumbnail?.source === 'string' && r.thumbnail.source.startsWith('https://') ? r.thumbnail.source : null,
              url: typeof r.content_urls?.desktop?.page === 'string' ? r.content_urls.desktop.page : `https://it.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            }
          : null,
      ),
      catchError(() => of(null)),
    );
  }

  // ---------- OSM via Overpass: servizi sul territorio ----------

  /**
   * Conteggio degli elementi OSM per categoria nell'area del comune (codice catastale).
   * Overpass è spesso sovraccarico: si provano più server, con un tempo massimo.
   */
  osmCounts(catasto: string, categories: string[]): Observable<number[]> {
    const body =
      `[out:json][timeout:40];area["ref:catasto"="${catasto}"]["boundary"="administrative"]->.a;` +
      categories.map(c => `nwr${c}(area.a);out count;`).join('');
    const servers = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
    const attempt = (i: number): Observable<number[]> =>
      this.http
        .post<unknown>(servers[i], new HttpParams().set('data', body).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        .pipe(
          timeout(45_000),
          map(parseOverpassCounts),
          catchError(err => (i + 1 < servers.length ? attempt(i + 1) : throwError(() => err))),
        );
    return /^[A-Z]\d{3}$/.test(catasto) ? attempt(0) : of([]);
  }

  // ---------- Protezione Civile: bollettini di criticità (GitHub pcm-dpc, CC BY 4.0) ----------

  /**
   * Id dell'ultimo bollettino (es. "20261008_1521"), dai file dell'ultima modifica al repository.
   * Due chiamate all'API di GitHub (limite 60/ora per IP): il servizio le tiene in cache.
   */
  dpcLatestId(): Observable<string | null> {
    const api = 'https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica';
    return this.http.get<{ sha: string }[]>(`${api}/commits`, { params: { per_page: 1, path: 'files' } }).pipe(
      switchMap(c => (c[0] ? this.http.get<{ files?: { filename: string }[] }>(`${api}/commits/${c[0].sha}`) : of({ files: [] }))),
      map(d => latestBulletinId((d.files ?? []).map(f => f.filename))),
      timeout(20_000),
    );
  }

  dpcBulletin(id: string): Observable<DpcBulletin> {
    return this.http
      .get<DpcBulletin>(`${DPC_RAW}/files/${id}.json`)
      .pipe(timeout(20_000), retryTransient());
  }

  dpcZones(topoUrl: string): Observable<AlertZone[]> {
    // solo URL del repository ufficiale: l'indirizzo arriva dal bollettino
    if (!topoUrl.startsWith(DPC_RAW + '/')) return of([]);
    return this.http.get<Topology>(topoUrl).pipe(timeout(45_000), retryTransient(), map(zonesFromTopo));
  }

  // ---------- Nominatim (OpenStreetMap, ODbL): nome del punto cliccato sulla mappa ----------
  // Policy: uso leggero, max 1 richiesta/s, nessun uso in massa. Si chiama solo su azione dell'utente.
  reverse(lat: number, lon: number): Observable<Place | null> {
    const params = new HttpParams()
      .set('lat', lat)
      .set('lon', lon)
      .set('format', 'jsonv2')
      .set('zoom', 10) // livello comune
      .set('namedetails', 1)
      .set('accept-language', 'it');
    return this.http
      .get<unknown>('https://nominatim.openstreetmap.org/reverse', { params })
      .pipe(map(r => toReversePlace(r, lat, lon)));
  }

  // ---------- Terremoti: INGV (Italia) e USGS (mondo), entrambi FDSN geojson ----------
  quakes(q: QuakeQuery): Observable<Quake[]> {
    const start = new Date(Date.now() - q.days * 86400_000).toISOString().slice(0, 19); // UTC
    let params = new HttpParams()
      .set('starttime', start)
      .set('minmagnitude', q.minMag)
      .set('orderby', 'time')
      .set('limit', QUAKE_LIMIT)
      .set('format', 'geojson');
    if (q.near) {
      params = params
        .set('latitude', q.near.lat)
        .set('longitude', q.near.lon)
        .set('maxradiuskm', q.near.radiusKm);
    } else if (q.source === 'ingv') {
      for (const [k, v] of Object.entries(ITALY_BBOX)) params = params.set(k, v);
    }
    // INGV risponde 204 senza corpo se non ci sono eventi: toQuakes gestisce il null
    return this.http
      .get<{ features?: unknown[] } | null>(FDSN[q.source], { params })
      .pipe(retryTransient(), map(toQuakes));
  }

  // ---------- dati.gov.it (CKAN): niente CORS, quindi JSONP ----------
  datasets(q: string, page: number, rows: number): Observable<{ total: number; hits: DatasetHit[] }> {
    const params = new HttpParams()
      .set('q', q.trim() || '*:*')
      .set('rows', rows)
      .set('start', page * rows);
    return this.http
      .jsonp<{ success: boolean; result: { count: number; results: unknown[] } }>(
        `https://www.dati.gov.it/opendata/api/3/action/package_search?${params}`,
        'callback',
      )
      .pipe(
        timeout(20_000), // JSONP non ha codici di errore: senza timeout potrebbe restare appeso
        map(r => ({ total: r.result.count, hits: r.result.results.map(toDataset) })),
      );
  }
}
