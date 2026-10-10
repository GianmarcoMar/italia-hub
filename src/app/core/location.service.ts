import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { ApisService } from './apis.service';
import { GeoService } from './geo.service';
import { regionByCode } from './italy';
import { Place, isPlace } from './parsers';

const KEY = 'italia-hub:place';

/** Nome provvisorio di un punto cliccato, finché (e se) Nominatim non trova un luogo. */
export const POINT_NAME = 'Punto selezionato';
const DEFAULT: Place = { name: 'Roma', detail: 'Lazio, Italia', lat: 41.8919, lon: 12.5113, nameEn: 'Rome' };

const sameCoords = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => a.lat === b.lat && a.lon === b.lon;

/**
 * Località selezionata, condivisa da mappa e pannelli (salvata in localStorage).
 * Si sceglie cliccando sulla mappa (nome da Nominatim) o dalla ricerca (Open-Meteo).
 */
@Injectable({ providedIn: 'root' })
export class LocationService {
  private api = inject(ApisService);
  private geo = inject(GeoService);

  readonly place = signal<Place>(this.load());
  /** true mentre si cerca il nome del punto cliccato. */
  readonly resolving = signal(false);

  /** Solo le coordinate: non cambia quando arriva il nome, così i dati non si ricaricano due volte. */
  readonly coords = computed(() => ({ lat: this.place().lat, lon: this.place().lon }), { equal: sameCoords });

  /** Regione e provincia ISTAT del punto, calcolate in locale dai confini. */
  readonly regionFeature = computed(() => this.geo.regionAt(this.coords().lat, this.coords().lon));
  readonly region = computed(() => regionByCode(this.regionFeature()?.properties.reg_istat_code_num));
  readonly province = computed(() => this.geo.provinceAt(this.coords().lat, this.coords().lon)?.properties ?? null);

  private reverse$ = new Subject<{ lat: number; lon: number; keepName: boolean }>();

  constructor() {
    // un clic rapido dopo l'altro fa una sola richiesta (policy Nominatim: max 1/s)
    this.reverse$
      .pipe(
        debounceTime(400),
        switchMap(q =>
          this.api.reverse(q.lat, q.lon).pipe(
            catchError(() => of(null)),
            map(found => ({ q, found })),
          ),
        ),
      )
      .subscribe(({ q, found }) => {
        const cur = this.place();
        this.resolving.set(false);
        if (!sameCoords(cur, q) || !found) return; // nel frattempo è stato scelto un altro punto
        this.commit(q.keepName ? { ...cur, nameEn: found.nameEn } : found);
      });
  }

  /** Punto cliccato sulla mappa: nome provvisorio, poi quello vero da Nominatim. */
  selectPoint(lat: number, lon: number) {
    const p = { lat: round(lat), lon: round(lon) };
    this.commit({ name: POINT_NAME, detail: `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`, ...p });
    this.resolving.set(true);
    this.reverse$.next({ ...p, keepName: false });
  }

  /** Località con nome già noto (ricerca, capoluoghi). Se manca il nome inglese lo si chiede a Nominatim. */
  selectPlace(p: Place) {
    this.commit(p);
    if (!p.nameEn) this.reverse$.next({ lat: p.lat, lon: p.lon, keepName: true });
  }

  private commit(p: Place) {
    this.place.set(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* storage non disponibile: pazienza */
    }
  }

  private load(): Place {
    try {
      const raw = localStorage.getItem(KEY);
      const p: unknown = raw ? JSON.parse(raw) : null;
      if (isPlace(p)) return p;
    } catch {
      /* valore corrotto o storage non disponibile: si usa il default */
    }
    return DEFAULT;
  }
}

/** 4 decimali (~10 m): abbastanza per il meteo, e le URL restano corte. */
const round = (v: number) => Math.round(v * 1e4) / 1e4;
