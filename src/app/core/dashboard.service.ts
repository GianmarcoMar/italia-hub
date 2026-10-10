import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, from, map, mergeMap, of, toArray } from 'rxjs';
import { aggregate } from './census';
import { CensusService } from './census.service';
import { AlertsService } from './alerts.service';
import { ApisService } from './apis.service';
import {
  AreaId,
  Insight,
  Level,
  Unit,
  VarId,
  aggregateUnit,
  alertExposure,
  areaTable,
  buildInsights,
  climateVars,
  comuneUnit,
  quakeRates,
  sizeTable,
} from './dashboard';
import { GeoService } from './geo.service';
import { ITALY_BOUNDS, REGIONS } from './italy';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Soglia del catalogo sismico usato nella dashboard: M3+ dal 1985 (circa 13.000 eventi). */
const QUAKE_MIN_MAG = 3;
const QUAKE_FROM = 1985;
/** Richieste NASA POWER in parallelo: il servizio è pubblico, si va piano. */
const CLIMATE_PARALLEL = 4;

/**
 * Stato e dati della dashboard di analisi: unità per livello (comuni, province, regioni),
 * fonti da caricare su richiesta (sismicità storica, clima, allerte) e conclusioni calcolate.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private census = inject(CensusService);
  private geo = inject(GeoService);
  private api = inject(ApisService);
  private alerts = inject(AlertsService);

  // ---------- scelte dell'utente ----------
  readonly level = signal<Level>('comune');
  readonly x = signal<VarId>('pct65');
  readonly y = signal<VarId>('inc');
  /** macro-aree nascoste nel grafico */
  readonly hidden = signal<ReadonlySet<AreaId>>(new Set());

  toggleArea(id: AreaId) {
    this.hidden.update(s => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Apre il grafico su una coppia di variabili (dalle conclusioni e dalla matrice). */
  plot(level: Level, x: VarId, y: VarId) {
    this.level.set(level);
    this.x.set(x);
    this.y.set(y);
  }

  // ---------- fonti da caricare su richiesta ----------
  readonly quakeState = signal<LoadState>('idle');
  private quakeData = signal<{ total: number; counts: Map<number, number> } | null>(null);

  readonly climateState = signal<LoadState>('idle');
  private climateData = signal<Map<number, Partial<Record<VarId, number | null>>>>(new Map());

  loadCensus() {
    this.census.load();
  }

  loadQuakes() {
    if (this.quakeState() === 'loading' || this.quakeState() === 'ready') return;
    this.quakeState.set('loading');
    const [[s, w], [n, e]] = ITALY_BOUNDS;
    this.api.quakeHistory({ box: [s, w, n, e] }, QUAKE_MIN_MAG).subscribe({
      next: events => {
        const counts = new Map<number, number>();
        let total = 0;
        for (const q of events) {
          const prov = this.geo.provinceAt(q.lat, q.lon)?.properties.prov_istat_code_num;
          if (prov === undefined) continue; // fuori dai confini: mare aperto o paesi vicini
          counts.set(prov, (counts.get(prov) ?? 0) + 1);
          total++;
        }
        this.quakeData.set({ total, counts });
        this.quakeState.set('ready');
      },
      error: () => this.quakeState.set('error'),
    });
  }

  loadClimate() {
    if (this.climateState() === 'loading' || this.climateState() === 'ready') return;
    this.climateState.set('loading');
    from(REGIONS)
      .pipe(
        mergeMap(
          r =>
            this.api.climate(r.capital.lat, r.capital.lon).pipe(
              map(c => ({ code: r.code, vars: c ? climateVars(c) : null })),
              catchError(() => of({ code: r.code, vars: null })),
            ),
          CLIMATE_PARALLEL,
        ),
        toArray(),
      )
      .subscribe(list => {
        const ok = list.filter(l => l.vars);
        this.climateData.set(new Map(ok.map(l => [l.code, l.vars!])));
        this.climateState.set(ok.length >= 5 ? 'ready' : 'error');
      });
  }

  loadAlerts() {
    this.alerts.load();
  }

  readonly alertState = computed<LoadState>(() => {
    if (this.alerts.error()) return 'error';
    if (this.alerts.zones().today.length) return 'ready';
    return this.alerts.loading() ? 'loading' : 'idle';
  });

  // ---------- unità di analisi ----------
  readonly ready = this.census.ready;
  private list = this.census.list;

  readonly areas = computed(() => areaTable(this.list()));
  readonly sizes = computed(() => sizeTable(this.list()));

  private comuneUnits = computed(() => this.list().map(comuneUnit));

  private provinceUnits = computed(() => {
    const names = new Map((this.geo.provinces.hasValue() ? this.geo.provinces.value().features : []).map(f => [f.properties.prov_istat_code_num, f.properties.prov_name]));
    const quake = this.quakeData();
    const areaKm2 = [...this.census.byProvince()].map(([prov, list]) => ({ prov, reg: list[0].reg, area: list.reduce((s, c) => s + c.area, 0) }));
    const rates = quake ? quakeRates(quake.counts, areaKm2) : null;
    return [...this.census.provinceAggs()].map(([prov, agg]) => {
      const reg = areaKm2.find(a => a.prov === prov)?.reg ?? 0;
      return aggregateUnit('province', String(prov), names.get(prov) ?? `Provincia ${prov}`, reg, prov, agg, rates ? { quakeRate: rates.byProv.get(prov) ?? null } : {});
    });
  });

  private regionUnits = computed(() => {
    const quake = this.quakeData();
    const climate = this.climateData();
    const provinces = [...this.census.byProvince()].map(([prov, list]) => ({ prov, reg: list[0].reg, area: list.reduce((s, c) => s + c.area, 0) }));
    const rates = quake ? quakeRates(quake.counts, provinces) : null;
    return REGIONS.map(r => {
      const agg = this.census.regionAggs().get(r.code) ?? aggregate([]);
      const extra = { ...(rates ? { quakeRate: rates.byReg.get(r.code) ?? null } : {}), ...(climate.get(r.code) ?? {}) };
      return aggregateUnit('region', String(r.code), r.name, r.code, null, agg, extra);
    });
  });

  readonly units = computed<Record<Level, Unit[]>>(() => ({
    comune: this.comuneUnits(),
    province: this.provinceUnits(),
    region: this.regionUnits(),
  }));

  // ---------- conclusioni ----------
  readonly insights = computed<Insight[]>(() => {
    if (!this.ready()) return [];
    const quake = this.quakeData();
    const zonesLoaded = this.alerts.zones().today.length > 0;
    return buildInsights({
      comuni: this.list(),
      units: this.units(),
      quake: quake ? { total: quake.total, fromYear: QUAKE_FROM } : undefined,
      alerts: zonesLoaded
        ? { exposure: alertExposure(this.list(), c => this.alerts.zoneOf(c, 'today')?.level ?? 0), title: this.alerts.title() }
        : undefined,
    });
  });
}
