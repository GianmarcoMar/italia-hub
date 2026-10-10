import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { rxResource, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, filter, map, of, shareReplay, take } from 'rxjs';
import { Aggregate, Comune, ComuneDetail, CensusFile, aggregate, mostPopulous, parseCensus } from './census';
import { Feature, FeatureCollection, GeoService, bbox } from './geo.service';
import { containsPoint } from './parsers';

export interface ComuneProps {
  /** nome */
  n: string;
  /** codice catastale */
  k: string;
  i: string;
  p: number;
  s: string;
  a: number;
  x: number;
  y: number;
}

/**
 * Dati statici sui comuni (public/data e public/geo/comuni, da scripts/build-data.mjs).
 * Tutto si carica su richiesta: l'elenco dei comuni (~300 KB compressi) alla prima necessità,
 * confini e dettagli una regione alla volta.
 */
@Injectable({ providedIn: 'root' })
export class CensusService {
  private http = inject(HttpClient);
  private geo = inject(GeoService);

  private wanted = signal(false);

  readonly file = rxResource({
    params: () => (this.wanted() ? true : undefined),
    stream: () => this.http.get<CensusFile>('data/comuni.json'),
  });

  /** Chiede il caricamento dei dati (idempotente). */
  load() {
    this.wanted.set(true);
  }

  readonly ready = computed(() => this.file.hasValue());

  /** Emette (una volta) quando i dati sono pronti; avvia il caricamento. */
  whenReady(): Observable<true> {
    this.load();
    return this.ready$;
  }
  private ready$ = toObservable(this.ready).pipe(
    filter((r): r is true => r),
    take(1),
    shareReplay(1),
  );
  readonly meta = computed(() => (this.file.hasValue() ? this.file.value() : null));

  readonly comuni = computed(() => (this.file.hasValue() ? parseCensus(this.file.value()) : new Map<string, Comune>()));
  readonly list = computed(() => [...this.comuni().values()]);

  readonly byProvince = computed(() => group(this.list(), c => c.prov));
  readonly byRegion = computed(() => group(this.list(), c => c.reg));

  readonly italy = computed(() => aggregate(this.list()));

  /** Comune principale (più popoloso) di ogni provincia: punto di riferimento per i dati in tempo reale. */
  readonly provinceCapitals = computed(() => {
    const out = new Map<number, Comune>();
    for (const [p, list] of this.byProvince()) {
      const c = mostPopulous(list);
      if (c) out.set(p, c);
    }
    return out;
  });

  /** Aggregati di tutte le province e regioni, calcolati una volta (classifiche, coropleta). */
  readonly provinceAggs = computed(() => new Map([...this.byProvince()].map(([k, l]) => [k, aggregate(l)])));
  readonly regionAggs = computed(() => new Map([...this.byRegion()].map(([k, l]) => [k, aggregate(l)])));

  provinceAggregate(code: number) {
    return this.provinceAggs().get(code) ?? aggregate([]);
  }

  regionAggregate(code: number) {
    return this.regionAggs().get(code) ?? aggregate([]);
  }

  /** Posizione di un territorio tra i pari (1 = il maggiore). */
  rankAmong<K>(aggs: Map<K, Aggregate>, key: K, value: (a: Aggregate) => number | null) {
    const mine = aggs.get(key);
    const v = mine ? value(mine) : null;
    if (v === null) return null;
    const valid = [...aggs.values()].map(value).filter((x): x is number => x !== null);
    return { rank: valid.filter(x => x > v).length + 1, of: valid.length };
  }

  // ---------- confini comunali, per regione ----------

  private geoCache = new Map<number, Observable<FeatureCollection<ComuneProps>>>();
  /** Regioni i cui confini comunali sono già arrivati. */
  readonly loadedGeo = signal(new Map<number, FeatureCollection<ComuneProps>>());
  private index = new Map<number, { f: Feature<ComuneProps>; box: [number, number, number, number] }[]>();

  geoOf(reg: number): Observable<FeatureCollection<ComuneProps>> {
    let o = this.geoCache.get(reg);
    if (!o) {
      o = this.http.get<FeatureCollection<ComuneProps>>(`geo/comuni/R${reg}.geojson`).pipe(
        map(fc => {
          this.index.set(reg, fc.features.map(f => ({ f, box: bbox(f.geometry) })));
          this.loadedGeo.update(m => new Map(m).set(reg, fc));
          return fc;
        }),
        catchError(() => {
          this.geoCache.delete(reg); // si potrà riprovare
          return of({ type: 'FeatureCollection', features: [] } as FeatureCollection<ComuneProps>);
        }),
        shareReplay(1),
      );
      this.geoCache.set(reg, o);
    }
    return o;
  }

  /** Carica (se serve) i confini della regione; utile da chiamare negli effect. */
  ensureGeo(reg: number) {
    if (!this.loadedGeo().has(reg)) this.geoOf(reg).subscribe();
  }

  /** Comune che contiene il punto, se i confini della sua regione sono già caricati. */
  comuneAtLoaded(lat: number, lon: number): Feature<ComuneProps> | null {
    const reg = this.geo.regionAt(lat, lon)?.properties.reg_istat_code_num;
    const list = reg ? this.index.get(reg) : undefined;
    if (!list) return null;
    for (const { f, box } of list) {
      const [s, w, n, e] = box;
      if (lat < s || lat > n || lon < w || lon > e) continue;
      if (containsPoint(f.geometry, lat, lon)) return f;
    }
    return null;
  }

  /** Comune che contiene il punto, caricando prima i confini della regione. */
  comuneAt(lat: number, lon: number): Observable<Feature<ComuneProps> | null> {
    const reg = this.geo.regionAt(lat, lon)?.properties.reg_istat_code_num;
    if (!reg) return of(null);
    return this.geoOf(reg).pipe(map(() => this.comuneAtLoaded(lat, lon)));
  }

  /** Confine di un comune dal suo codice catastale (regione già caricata). */
  featureOf(k: string): Feature<ComuneProps> | null {
    const c = this.comuni().get(k);
    return (c && this.index.get(c.reg)?.find(x => x.f.properties.k === k)?.f) ?? null;
  }

  // ---------- dettagli (piramidi, fasce di reddito, serie), per regione ----------

  private detailCache = new Map<number, Observable<Record<string, ComuneDetail>>>();

  detailOf(reg: number): Observable<Record<string, ComuneDetail>> {
    let o = this.detailCache.get(reg);
    if (!o) {
      o = this.http.get<Record<string, ComuneDetail>>(`data/dettaglio/R${reg}.json`).pipe(
        catchError(() => {
          this.detailCache.delete(reg);
          return of({});
        }),
        shareReplay(1),
      );
      this.detailCache.set(reg, o);
    }
    return o;
  }

  /** Ricerca per nome (palette dei comandi): prima chi inizia con il testo, poi i più popolosi. */
  search(q: string, limit = 8): Comune[] {
    const n = norm(q);
    if (n.length < 2) return [];
    return this.list()
      .filter(c => norm(c.name).includes(n))
      .sort((a, b) => Number(norm(b.name).startsWith(n)) - Number(norm(a.name).startsWith(n)) || (b.pop ?? 0) - (a.pop ?? 0))
      .slice(0, limit);
  }
}

function group<K>(list: Comune[], key: (c: Comune) => K): Map<K, Comune[]> {
  const m = new Map<K, Comune[]>();
  for (const c of list) {
    const k = key(c);
    const arr = m.get(k);
    if (arr) arr.push(c);
    else m.set(k, [c]);
  }
  return m;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
