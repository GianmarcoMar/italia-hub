import { Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActionsService } from '../core/actions.service';
import { CensusService } from '../core/census.service';
import { GeoService, bbox } from '../core/geo.service';
import { regionByCode } from '../core/italy';
import { MapService } from '../core/map.service';
import { AnalysisStore, CapitalsWeatherStore, QuakeStore } from '../core/stores';
import { weatherIcon } from '../core/weather';
import { GraphNode, RelGraph } from '../shared/rel-graph';
import { QuakeArea } from './panels/history-panel';
import { TerritoryDossier } from './territory-dossier';

/** Scheda di una regione: relazioni, province, dossier dei comuni. */
@Component({
  selector: 'app-region-entity',
  imports: [DecimalPipe, RelGraph, TerritoryDossier],
  template: `
    @if (region(); as r) {
      <header class="head">
        <div>
          <span class="tag">Regione</span>
          <span class="id mono">ISTAT {{ r.code < 10 ? '0' + r.code : r.code }}</span>
        </div>
        <h1>{{ r.name }}</h1>
        <p class="muted small mono">{{ provinces().length }} province · {{ comuni().length | number }} comuni</p>
        <div class="actions">
          <button type="button" class="ghost" (click)="frame()">◎ Inquadra</button>
          <button type="button" class="ghost" (click)="actions.focusItaly()">Italia ↑</button>
          <button type="button" class="ghost" (click)="actions.goCapital(r)">Meteo {{ r.capital.name }}</button>
        </div>
      </header>

      <section class="kpis">
        <div><b>{{ quakeStats()?.count ?? 0 }}</b><span>eventi sismici{{ quakes.window() ? ' (finestra)' : '' }}</span></div>
        <div><b>{{ quakeStats()?.maxMag ? (quakeStats()!.maxMag | number: '1.1-1') : '—' }}</b><span>magnitudo max</span></div>
        <div><b>{{ capitalNow() ? (capitalNow()!.temp | number: '1.0-0') + '°' : '—' }}</b><span>{{ r.capital.name }} ora</span></div>
      </section>

      <section>
        <h3>Province</h3>
        <div class="chips">
          @for (p of provinces(); track p.properties.prov_istat_code_num) {
            <button type="button" class="ghost" (click)="actions.focusProvince(p.properties.prov_istat_code_num)">
              {{ p.properties.prov_name }} <span class="mono muted">{{ p.properties.prov_acr }}</span>
            </button>
          }
        </div>
      </section>

      <section>
        <h3>Collegamenti</h3>
        <app-rel-graph [center]="{ label: r.name, kind: 'region' }" [nodes]="graph()" (pick)="open($event)" />
      </section>

      @if (census.ready()) {
        <app-territory-dossier
          [comuni]="comuni()"
          [label]="r.name.slice(0, 12)"
          [capital]="capitalComune()"
          [compare]="compare()"
          [ranks]="ranks()"
          [incomeRanks]="incomeRanks()"
          [regions]="[r.code]"
          [quakeArea]="quakeArea()"
          [minMag]="3"
          [liveRadius]="60"
        />
      } @else {
        <div class="skeleton" style="height: 300px"></div>
      }
    }
  `,
  styleUrl: './entity.css',
})
export class RegionEntity {
  readonly code = input.required<number>();

  protected census = inject(CensusService);
  private geo = inject(GeoService);
  private mapSvc = inject(MapService);
  private analysis = inject(AnalysisStore);
  private capitals = inject(CapitalsWeatherStore);
  protected quakes = inject(QuakeStore);
  protected actions = inject(ActionsService);

  constructor() {
    this.census.load();
  }

  protected region = computed(() => regionByCode(this.code()));
  private feature = computed(() => this.geo.regionFeature(this.code()) ?? null);
  protected provinces = computed(() => this.geo.provincesOf(this.code()));
  protected comuni = computed(() => this.census.byRegion().get(this.code()) ?? []);
  protected quakeStats = computed(() => this.analysis.quakesByRegion().get(this.code()));
  protected capitalNow = computed(() => this.capitals.list().find(x => x.region.code === this.code())?.now ?? null);

  /** Comune capoluogo di regione, dai dati ISTAT (per nome). */
  protected capitalComune = computed(() => {
    const name = this.region()?.capital.name;
    return this.comuni().find(c => c.name === name) ?? null;
  });

  protected compare = computed(() => [{ label: 'Italia', agg: this.census.italy() }]);

  protected ranks = computed(() => {
    const r = this.census.rankAmong(this.census.regionAggs(), this.code(), a => a.pop);
    const o = this.census.rankAmong(this.census.regionAggs(), this.code(), a => a.ageMean);
    return [...(r ? [{ label: 'per popolazione tra le regioni', ...r }] : []), ...(o ? [{ label: 'per età media', ...o }] : [])];
  });

  protected incomeRanks = computed(() => {
    const r = this.census.rankAmong(this.census.regionAggs(), this.code(), a => a.inc);
    return r ? [{ label: 'per reddito tra le regioni', ...r }] : [];
  });

  protected quakeArea = computed<QuakeArea>(() => {
    const f = this.feature();
    return f ? { box: bbox(f.geometry) } : { lat: 0, lon: 0, radiusKm: 1 };
  });

  /** Eventi visibili che cadono nella regione, dal più forte. */
  private topQuakes = computed(() =>
    this.quakes
      .visible()
      .filter(q => this.geo.regionAt(q.lat, q.lon)?.properties.reg_istat_code_num === this.code())
      .sort((a, b) => b.mag - a.mag)
      .slice(0, 3),
  );

  protected graph = computed<GraphNode[]>(() => {
    const r = this.region();
    if (!r) return [];
    const c = this.capitalNow();
    const nodes: GraphNode[] = [
      { id: 'cap', label: r.capital.name, kind: 'city', sub: c ? `${Math.round(c.temp)}° ${weatherIcon(c.code)}` : 'capoluogo' },
    ];
    for (const q of this.topQuakes()) nodes.push({ id: `q:${q.id}`, label: q.place, kind: 'quake', sub: `M${q.mag.toFixed(1)}` });
    for (const p of this.provinces().slice(0, 10 - nodes.length)) {
      nodes.push({ id: `p:${p.properties.prov_istat_code_num}`, label: p.properties.prov_name, kind: 'province', sub: p.properties.prov_acr });
    }
    return nodes;
  });

  protected frame() {
    const f = this.feature();
    if (f) this.mapSvc.fitBox(bbox(f.geometry));
  }

  protected open(id: string) {
    const r = this.region();
    if (!r) return;
    if (id === 'cap') {
      const c = this.capitalComune();
      if (c) this.actions.focusComune(c);
      else this.actions.goCapital(r);
    } else if (id.startsWith('q:')) {
      const q = this.quakes.byId().get(id.slice(2));
      if (q) this.actions.focusQuake(q);
    } else if (id.startsWith('p:')) {
      this.actions.focusProvince(+id.slice(2));
    }
  }
}
