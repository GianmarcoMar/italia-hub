import { DestroyRef, Injectable, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TimeWindow, countByRegion, inWindow, weatherAlert } from './analysis';
import { ApisService, QuakeQuery, QuakeSource } from './apis.service';
import { GeoService } from './geo.service';
import { REGIONS } from './italy';
import { LocationService } from './location.service';

/**
 * Dati condivisi tra mappa, pannelli, timeline e feed. Sono servizi root: cambiando scheda i dati
 * restano in memoria e tutti leggono la stessa risorsa, senza richieste doppie.
 */

/** Ripete `fn` ogni `ms` finché l'app è aperta (i servizi root vivono quanto l'app). */
function every(ms: number, fn: () => void) {
  const id = setInterval(fn, ms);
  inject(DestroyRef).onDestroy(() => clearInterval(id));
}

/** Memorizza l'ora dell'ultimo caricamento riuscito di una risorsa. */
function trackUpdated(status: () => string) {
  const at = signal<number | null>(null);
  effect(() => {
    if (status() === 'resolved' || status() === 'local') at.set(Date.now());
  });
  return at.asReadonly();
}

/** Previsioni per la località selezionata. */
@Injectable({ providedIn: 'root' })
export class ForecastStore {
  private api = inject(ApisService);
  private loc = inject(LocationService);

  readonly forecast = rxResource({
    params: () => this.loc.coords(),
    stream: ({ params: p }) => this.api.forecast(p.lat, p.lon),
  });

  readonly current = computed(() => (this.forecast.hasValue() ? this.forecast.value().current : null));
  readonly updatedAt = trackUpdated(() => this.forecast.status());
}

/** Meteo attuale dei 20 capoluoghi di regione, in una sola richiesta, aggiornato ogni 15 minuti. */
@Injectable({ providedIn: 'root' })
export class CapitalsWeatherStore {
  private api = inject(ApisService);

  readonly weather = rxResource({
    stream: () => this.api.nowWeather(REGIONS.map(r => r.capital)),
  });

  /** Stesso ordine di REGIONS. */
  readonly list = computed(() => {
    const w = this.weather.hasValue() ? this.weather.value() : [];
    return REGIONS.map((region, i) => ({ region, now: w[i] ?? null }));
  });

  readonly updatedAt = trackUpdated(() => this.weather.status());

  /** Allerte derivate dal meteo attuale dei capoluoghi. */
  readonly alerts = computed(() =>
    this.list()
      .map(x => ({ ...x, alert: weatherAlert(x.now) }))
      .filter(x => x.alert !== null),
  );

  constructor() {
    // ~96 chiamate da 20 punti al giorno: ben sotto il limite di Open-Meteo
    every(15 * 60_000, () => this.weather.reload());
  }
}

const QUAKE_RADIUS_KM = 100;

/** Filtri, finestra temporale e risultati dei terremoti: pannelli e timeline li modificano, la mappa li disegna. */
@Injectable({ providedIn: 'root' })
export class QuakeStore {
  private api = inject(ApisService);
  private loc = inject(LocationService);

  readonly source = signal<QuakeSource>('ingv');
  readonly days = signal(7);
  readonly minMag = signal(2);
  readonly near = signal(false);

  readonly query = computed<QuakeQuery>(() => {
    // la località si legge solo se serve, così senza "near" cambiarla non ricarica
    const p = this.near() ? this.loc.coords() : null;
    return {
      source: this.source(),
      days: this.days(),
      minMag: this.minMag(),
      near: p ? { lat: p.lat, lon: p.lon, radiusKm: QUAKE_RADIUS_KM } : null,
    };
  });

  readonly quakes = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.api.quakes(params),
  });

  /** Tutti gli eventi del periodo. */
  readonly list = computed(() => (this.quakes.hasValue() ? this.quakes.value() : []));

  /** Finestra scelta sulla timeline; si azzera quando cambiano i filtri. */
  readonly window = linkedSignal<QuakeQuery, TimeWindow | null>({ source: this.query, computation: () => null });

  /** Eventi nella finestra: è quello che mostrano mappa, elenchi e analisi. */
  readonly visible = computed(() => inWindow(this.list(), this.window()));

  readonly byId = computed(() => new Map(this.list().map(q => [q.id, q])));

  readonly updatedAt = trackUpdated(() => this.quakes.status());

  /** Intervallo coperto dal periodo scelto, per la timeline. */
  range(): TimeWindow {
    const to = this.updatedAt() ?? Date.now();
    return [to - this.days() * 86_400_000, to];
  }

  constructor() {
    // feed live: nuovi eventi ogni 2 minuti (reload mantiene i dati mentre ricarica)
    every(2 * 60_000, () => {
      if (!this.quakes.isLoading()) this.quakes.reload();
    });
  }
}

/** Terremoti visibili aggregati per regione (punto nel poligono, in locale): schede e coropleta. */
@Injectable({ providedIn: 'root' })
export class AnalysisStore {
  private geo = inject(GeoService);
  private quakes = inject(QuakeStore);

  readonly quakesByRegion = computed(() => {
    this.geo.regions.hasValue(); // ricalcola quando arrivano i confini
    return countByRegion(this.quakes.visible(), (lat, lon) => this.geo.regionAt(lat, lon)?.properties.reg_istat_code_num ?? null);
  });
}
