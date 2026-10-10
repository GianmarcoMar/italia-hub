import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ALERT_COLOR, ALERT_LABEL, AlertLevel } from './alerts';
import { AlertsService } from './alerts.service';
import { QUAKE_STEPS, Step, TEMP_STEPS, stepColor } from './analysis';
import { ApisService } from './apis.service';
import { metricById, metricSteps } from './census';
import { CensusService } from './census.service';
import { MapService } from './map.service';
import { AQI_BANDS } from './parsers';
import { AnalysisStore, CapitalsWeatherStore } from './stores';
import { REGIONS } from './italy';

export type ChoroLevel = 'region' | 'province' | 'comune' | null;

export interface Legend {
  title: string;
  steps: Step[];
  note?: string;
}

const AQI_STEPS: Step[] = AQI_BANDS.map((b, i) => ({ min: i === 0 ? -Infinity : AQI_BANDS[i - 1].max + 0.0001, color: b.color, label: b.label }));
const ALERT_STEPS: Step[] = [1, 2, 3].map(l => ({ min: l, color: ALERT_COLOR[l], label: ALERT_LABEL[l].replace('Allerta ', '') }));

/**
 * Coropleta della mappa a tre livelli. Carica solo i dati che servono alla coropleta attiva:
 * censimento per i comuni, bollettino DPC per le allerte, 107 punti Open-Meteo per le province.
 */
@Injectable({ providedIn: 'root' })
export class ChoroplethService {
  private mapSvc = inject(MapService);
  private census = inject(CensusService);
  private alerts = inject(AlertsService);
  private analysis = inject(AnalysisStore);
  private capitals = inject(CapitalsWeatherStore);
  private api = inject(ApisService);

  readonly mode = this.mapSvc.choropleth;

  readonly level = computed<ChoroLevel>(() => {
    const m = this.mode();
    if (m === 'quakes' || m === 'temp') return 'region';
    if (m.startsWith('p:')) return 'province';
    if (m.startsWith('c:')) return 'comune';
    return null;
  });

  constructor() {
    effect(() => {
      const m = this.mode();
      if (m.startsWith('c:') || m.startsWith('p:')) this.census.load();
      if (m === 'c:alert' || m === 'c:alert2') this.alerts.load();
    });
    // le province in tempo reale si aggiornano ogni ora, solo se la coropleta è attiva
    const id = setInterval(() => {
      if (this.mode() === 'p:aqi') this.provAqi.reload();
      if (this.mode() === 'p:temp') this.provTemp.reload();
    }, 60 * 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  // ---------- province in tempo reale ----------

  /** Capoluoghi (comune più popoloso) di tutte le province, in ordine fisso. */
  private provPoints = computed(() => [...this.census.provinceCapitals().entries()].sort((a, b) => a[0] - b[0]));

  private provAqi = rxResource({
    params: () => (this.mode() === 'p:aqi' && this.provPoints().length ? this.provPoints() : undefined),
    stream: ({ params: pts }) => this.api.aqiMany(pts.map(([, c]) => ({ lat: c.y, lon: c.x }))),
  });

  private provTemp = rxResource({
    params: () => (this.mode() === 'p:temp' && this.provPoints().length ? this.provPoints() : undefined),
    stream: ({ params: pts }) => this.api.nowWeather(pts.map(([, c]) => ({ lat: c.y, lon: c.x }))),
  });

  /** Valore per provincia della coropleta provinciale attiva. */
  readonly provinceValues = computed(() => {
    const out = new Map<number, number | null>();
    const pts = this.provPoints();
    if (this.mode() === 'p:aqi' && this.provAqi.hasValue()) {
      const v = this.provAqi.value();
      pts.forEach(([p], i) => out.set(p, v[i] ?? null));
    }
    if (this.mode() === 'p:temp' && this.provTemp.hasValue()) {
      const v = this.provTemp.value();
      pts.forEach(([p], i) => out.set(p, v[i]?.temp ?? null));
    }
    return out;
  });

  readonly provinceFills = computed(() => {
    const steps = this.mode() === 'p:aqi' ? AQI_STEPS : TEMP_STEPS;
    const out = new Map<number, string>();
    for (const [p, v] of this.provinceValues()) {
      const c = stepColor(v, steps);
      if (c) out.set(p, c);
    }
    return out;
  });

  readonly loading = computed(() => {
    const m = this.mode();
    if (m === 'p:aqi') return this.provAqi.isLoading() || !this.census.ready();
    if (m === 'p:temp') return this.provTemp.isLoading() || !this.census.ready();
    if (m === 'c:alert' || m === 'c:alert2') return this.alerts.loading() || !this.census.ready();
    if (m.startsWith('c:')) return !this.census.ready();
    return false;
  });

  // ---------- regioni ----------

  readonly regionFills = computed(() => {
    const mode = this.mode();
    const out = new Map<number, string>();
    if (mode !== 'quakes' && mode !== 'temp') return out;
    const temps = new Map(this.capitals.list().map(x => [x.region.code, x.now?.temp ?? null]));
    for (const r of REGIONS) {
      const v = mode === 'quakes' ? (this.analysis.quakesByRegion().get(r.code)?.count ?? 0) : temps.get(r.code);
      const c = stepColor(v, mode === 'quakes' ? QUAKE_STEPS : TEMP_STEPS);
      if (c) out.set(r.code, c);
    }
    return out;
  });

  // ---------- comuni ----------

  private comuneSteps = computed(() => {
    const m = metricById(this.mode().slice(2));
    return m && this.census.ready() ? metricSteps(m, this.census.list()) : [];
  });

  /** Colore di ogni comune (codice catastale) per la coropleta comunale attiva. */
  readonly comuneFills = computed(() => {
    const out = new Map<string, string>();
    const mode = this.mode();
    if (!mode.startsWith('c:') || !this.census.ready()) return out;
    if (mode === 'c:alert' || mode === 'c:alert2') {
      const day = mode === 'c:alert' ? 'today' : 'tomorrow';
      if (!this.alerts.zones()[day].length) return out;
      for (const c of this.census.list()) {
        const l = this.alerts.zoneOf(c, day)?.level ?? 0;
        if (l) out.set(c.k, ALERT_COLOR[l as AlertLevel]);
      }
      return out;
    }
    const m = metricById(mode.slice(2));
    const steps = this.comuneSteps();
    if (!m) return out;
    for (const c of this.census.list()) {
      const col = stepColor(m.value(c), steps);
      if (col) out.set(c.k, col);
    }
    return out;
  });

  readonly legend = computed<Legend | null>(() => {
    const mode = this.mode();
    switch (mode) {
      case 'none':
        return null;
      case 'quakes':
        return { title: 'Terremoti per regione', steps: QUAKE_STEPS };
      case 'temp':
        return { title: 'Temperatura del capoluogo di regione', steps: TEMP_STEPS };
      case 'p:aqi':
        return { title: 'Qualità dell\'aria ora (EAQI)', steps: AQI_STEPS, note: 'Capoluogo di ogni provincia · Open-Meteo CAMS · ogni ora' };
      case 'p:temp':
        return { title: 'Temperatura ora per provincia', steps: TEMP_STEPS, note: 'Capoluogo di ogni provincia · Open-Meteo' };
      case 'c:alert':
      case 'c:alert2':
        return {
          title: `Allerta meteo-idro ${mode === 'c:alert' ? 'oggi' : 'domani'}`,
          steps: ALERT_STEPS,
          note: this.alerts.title() ?? 'Protezione Civile',
        };
      default: {
        const m = metricById(mode.slice(2));
        return m ? { title: `${m.label} (${m.unit})`, steps: this.comuneSteps(), note: 'Tutti i comuni · ISTAT / MEF' } : null;
      }
    }
  });
}

/** Opzioni della coropleta per il pannello dei layer, raggruppate per livello. */
export const CHORO_GROUPS: { label: string; options: { v: string; label: string }[] }[] = [
  {
    label: 'Regioni',
    options: [
      { v: 'quakes', label: 'Terremoti (finestra timeline)' },
      { v: 'temp', label: 'Temperatura del capoluogo' },
    ],
  },
  {
    label: 'Province · tempo reale',
    options: [
      { v: 'p:aqi', label: 'Qualità dell\'aria (EAQI)' },
      { v: 'p:temp', label: 'Temperatura' },
    ],
  },
  {
    label: 'Comuni · Protezione Civile',
    options: [
      { v: 'c:alert', label: 'Allerta meteo-idro oggi' },
      { v: 'c:alert2', label: 'Allerta meteo-idro domani' },
    ],
  },
  {
    label: 'Comuni · ISTAT / MEF',
    options: [
      { v: 'c:density', label: 'Densità abitativa' },
      { v: 'c:pop', label: 'Popolazione' },
      { v: 'c:popChange', label: 'Variazione popolazione 2020–25' },
      { v: 'c:age', label: 'Età media' },
      { v: 'c:old', label: 'Quota over 65' },
      { v: 'c:foreign', label: 'Quota stranieri' },
      { v: 'c:income', label: 'Reddito medio 2024' },
      { v: 'c:incomeChange', label: 'Variazione reddito 2019–24' },
    ],
  },
];
