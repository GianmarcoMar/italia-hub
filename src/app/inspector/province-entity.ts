import { Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActionsService } from '../core/actions.service';
import { CensusService } from '../core/census.service';
import { GeoService, bbox } from '../core/geo.service';
import { regionByCode } from '../core/italy';
import { MapService } from '../core/map.service';
import { QuakeArea } from './panels/history-panel';
import { TerritoryDossier } from './territory-dossier';

/** Scheda di una provincia (o città metropolitana): dossier dei suoi comuni. */
@Component({
  selector: 'app-province-entity',
  imports: [DecimalPipe, TerritoryDossier],
  template: `
    @if (feature(); as f) {
      <header class="head">
        <div>
          <span class="tag">Provincia</span>
          <span class="id mono">ISTAT {{ f.properties.prov_istat_code_num }} · {{ f.properties.prov_acr }}</span>
        </div>
        <h1>{{ f.properties.prov_name }}</h1>
        <p class="muted small mono">{{ region()?.name }} · {{ comuni().length | number }} comuni</p>
        <div class="actions">
          <button type="button" class="ghost" (click)="frame()">◎ Inquadra</button>
          <button type="button" class="ghost" (click)="actions.focusRegion(f.properties.reg_istat_code_num)">Regione ↑</button>
          @if (capital(); as c) {
            <button type="button" class="ghost" (click)="actions.focusComune(c)">Apri {{ c.name }}</button>
          }
        </div>
      </header>

      @if (census.ready()) {
        <app-territory-dossier
          [comuni]="comuni()"
          [label]="f.properties.prov_acr"
          [capital]="capital()"
          [compare]="compare()"
          [ranks]="ranks()"
          [incomeRanks]="incomeRanks()"
          [regions]="regions()"
          [quakeArea]="quakeArea()"
          [minMag]="2.5"
          [liveRadius]="40"
        />
      } @else {
        <div class="skeleton" style="height: 300px"></div>
      }
    } @else {
      <div class="skeleton" style="height: 200px"></div>
    }
  `,
  styleUrl: './entity.css',
})
export class ProvinceEntity {
  readonly code = input.required<number>();

  protected census = inject(CensusService);
  private geo = inject(GeoService);
  private mapSvc = inject(MapService);
  protected actions = inject(ActionsService);

  constructor() {
    this.census.load();
  }

  protected feature = computed(() =>
    this.geo.provinces.hasValue() ? (this.geo.provinces.value().features.find(f => f.properties.prov_istat_code_num === this.code()) ?? null) : null,
  );
  protected region = computed(() => regionByCode(this.feature()?.properties.reg_istat_code_num));
  protected comuni = computed(() => this.census.byProvince().get(this.code()) ?? []);
  protected capital = computed(() => this.census.provinceCapitals().get(this.code()) ?? null);
  protected regions = computed(() => [this.feature()?.properties.reg_istat_code_num ?? 0].filter(Boolean));

  protected compare = computed(() => {
    const r = this.region();
    return [
      ...(r ? [{ label: r.name.slice(0, 12), agg: this.census.regionAggregate(r.code) }] : []),
      { label: 'Italia', agg: this.census.italy() },
    ];
  });

  protected ranks = computed(() => {
    const r = this.census.rankAmong(this.census.provinceAggs(), this.code(), a => a.pop);
    const d = this.census.rankAmong(this.census.provinceAggs(), this.code(), a => a.density);
    return [
      ...(r ? [{ label: 'per popolazione tra le province', ...r }] : []),
      ...(d ? [{ label: 'per densità', ...d }] : []),
    ];
  });

  protected incomeRanks = computed(() => {
    const r = this.census.rankAmong(this.census.provinceAggs(), this.code(), a => a.inc);
    return r ? [{ label: 'per reddito tra le province', ...r }] : [];
  });

  protected quakeArea = computed<QuakeArea>(() => {
    const f = this.feature();
    return f ? { box: bbox(f.geometry) } : { lat: 0, lon: 0, radiusKm: 1 };
  });

  protected frame() {
    const f = this.feature();
    if (f) this.mapSvc.fitBox(bbox(f.geometry));
  }
}
