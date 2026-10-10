import { Component, computed, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { km, relatedQuakes } from '../core/analysis';
import { ActionsService } from '../core/actions.service';
import { ago, depthColor } from '../core/format';
import { GeoService } from '../core/geo.service';
import { regionByCode } from '../core/italy';
import { LocationService } from '../core/location.service';
import { MapService } from '../core/map.service';
import { SelectionService } from '../core/selection.service';
import { QuakeStore } from '../core/stores';
import { GraphNode, RelGraph } from '../shared/rel-graph';

/** Scheda di un evento sismico: proprietà, collegamenti (grafo) ed eventi correlati. */
@Component({
  selector: 'app-quake-entity',
  imports: [DatePipe, DecimalPipe, RelGraph],
  template: `
    @if (q(); as q) {
      <header class="head">
        <div>
          <span class="tag warn">Evento sismico</span>
          <span class="id mono">ID {{ q.id }}</span>
        </div>
        <div class="title">
          <span class="mag mono" [style.borderColor]="color(q.depthKm)" [style.color]="color(q.depthKm)">
            {{ q.mag | number: '1.1-1' }}
          </span>
          <div>
            <h1>{{ q.place }}</h1>
            <p class="muted small mono">{{ q.time | date: 'EEEE d MMMM y, HH:mm:ss' }} · {{ since(q.time) }}</p>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="ghost" (click)="mapSvc.flyTo(q.lat, q.lon, 10)">◎ Centra</button>
          @if (officialUrl(); as u) {
            <a class="ghost-link" [href]="u" target="_blank" rel="noopener">Scheda ufficiale ↗</a>
          }
        </div>
      </header>

      <section>
        <h3>Proprietà</h3>
        <dl class="props">
          <dt>Magnitudo</dt>
          <dd>M {{ q.mag | number: '1.1-1' }}</dd>
          <dt>Profondità</dt>
          <dd>{{ q.depthKm === null ? '—' : (q.depthKm | number: '1.0-1') + ' km' }}</dd>
          <dt>Ora UTC</dt>
          <dd>{{ q.time | date: 'dd/MM/yyyy HH:mm:ss' : 'UTC' }}</dd>
          <dt>Coordinate</dt>
          <dd>{{ q.lat | number: '1.4-4' }}, {{ q.lon | number: '1.4-4' }}</dd>
          <dt>Fonte</dt>
          <dd>{{ store.source() === 'ingv' ? 'INGV · FDSN' : 'USGS · FDSN' }}</dd>
          @if (region(); as r) {
            <dt>Regione</dt>
            <dd>{{ r.name }}</dd>
          }
          @if (province(); as p) {
            <dt>Provincia</dt>
            <dd>{{ p.prov_name }} ({{ p.prov_acr }})</dd>
          }
          <dt>Distanza da {{ loc.place().name }}</dt>
          <dd>{{ distance() | number: '1.0-0' }} km</dd>
        </dl>
      </section>

      <section>
        <h3>Collegamenti</h3>
        <app-rel-graph [center]="{ label: 'M' + q.mag.toFixed(1), kind: 'quake' }" [nodes]="graph()" (pick)="open($event)" />
      </section>

      <section>
        <h3>Eventi correlati · entro 30 km e 48 h</h3>
        <ul class="rel">
          @for (r of related(); track r.id) {
            <li (mouseenter)="sel.hoveredQuake.set(r.id)" (mouseleave)="sel.hoveredQuake.set(null)">
              <button type="button" (click)="actions.focusQuake(r)">
                <span class="mono m" [style.color]="color(r.depthKm)">M{{ r.mag | number: '1.1-1' }}</span>
                <span class="txt">{{ r.place }}</span>
                <span class="mono muted">{{ r.distKm | number: '1.0-0' }} km · {{ dt(r.time - q.time) }}</span>
              </button>
            </li>
          } @empty {
            <li class="muted small">Nessun evento correlato nell'elenco attuale: evento isolato.</li>
          }
        </ul>
      </section>
    } @else {
      <p class="muted">
        L'evento non è più nell'elenco (filtri o periodo cambiati).
        <button type="button" class="link" (click)="sel.selectPlace()">Torna alla località</button>
      </p>
    }
  `,
  styleUrl: './entity.css',
})
export class QuakeEntity {
  readonly id = input.required<string>();

  protected store = inject(QuakeStore);
  protected sel = inject(SelectionService);
  protected actions = inject(ActionsService);
  protected mapSvc = inject(MapService);
  protected loc = inject(LocationService);
  private geo = inject(GeoService);
  protected readonly color = depthColor;
  protected readonly since = ago;

  protected q = computed(() => this.store.byId().get(this.id()) ?? null);

  protected region = computed(() => {
    const q = this.q();
    return q ? regionByCode(this.geo.regionAt(q.lat, q.lon)?.properties.reg_istat_code_num) : undefined;
  });

  private provinceFeature = computed(() => {
    const q = this.q();
    return q ? this.geo.provinceAt(q.lat, q.lon) : null;
  });
  protected province = computed(() => this.provinceFeature()?.properties ?? null);

  protected distance = computed(() => {
    const q = this.q();
    return q ? km(q, this.loc.coords()) : 0;
  });

  protected related = computed(() => {
    const q = this.q();
    return q ? relatedQuakes(q, this.store.list()).slice(0, 8) : [];
  });

  /** INGV non manda l'URL dell'evento: si costruisce dall'ID; USGS lo manda. */
  protected officialUrl = computed(() => {
    const q = this.q();
    if (!q) return null;
    if (q.url) return q.url;
    return this.store.source() === 'ingv' && /^\d+$/.test(q.id) ? `https://terremoti.ingv.it/event/${q.id}` : null;
  });

  protected graph = computed<GraphNode[]>(() => {
    const nodes: GraphNode[] = [];
    const r = this.region();
    if (r) nodes.push({ id: `r:${r.code}`, label: r.name, kind: 'region', sub: 'regione' });
    const p = this.province();
    if (p) nodes.push({ id: 'p', label: p.prov_name, kind: 'province', sub: p.prov_acr });
    nodes.push({ id: 'place', label: this.loc.place().name, kind: 'place', sub: `${Math.round(this.distance())} km` });
    for (const x of this.related().slice(0, 6)) {
      nodes.push({ id: `q:${x.id}`, label: x.place, kind: 'quake', sub: `M${x.mag.toFixed(1)} · ${Math.round(x.distKm)} km` });
    }
    return nodes;
  });

  protected open(id: string) {
    if (id.startsWith('r:')) this.actions.focusRegion(+id.slice(2));
    else if (id === 'p' && this.provinceFeature()) this.actions.goProvince(this.provinceFeature()!);
    else if (id === 'place') {
      const c = this.loc.coords();
      this.sel.selectPlace();
      this.mapSvc.flyTo(c.lat, c.lon, 10);
    } else if (id.startsWith('q:')) {
      const q = this.store.byId().get(id.slice(2));
      if (q) this.actions.focusQuake(q);
    }
  }

  /** Scarto di tempo leggibile: "+3 h", "−1 g". */
  protected dt(ms: number) {
    const h = ms / 3_600_000;
    const sign = h >= 0 ? '+' : '−';
    const a = Math.abs(h);
    return a < 1 ? `${sign}${Math.round(a * 60)} min` : a < 24 ? `${sign}${Math.round(a)} h` : `${sign}${(a / 24).toFixed(1)} g`;
  }
}
