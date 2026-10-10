import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { ActionsService } from '../core/actions.service';
import { ApisService } from '../core/apis.service';
import { Comune, rankOf, single, sumArrays } from '../core/census';
import { CensusService } from '../core/census.service';
import { GeoService } from '../core/geo.service';
import { regionByCode } from '../core/italy';
import { DemoPanel } from './panels/demo-panel';
import { EconomyPanel } from './panels/economy-panel';
import { HistoryPanel, QuakeArea } from './panels/history-panel';
import { LivePanel } from './panels/live-panel';

/** Categorie OSM per il censimento dei servizi (filtri Overpass statici). */
const OSM = [
  { label: 'Farmacie', q: '["amenity"="pharmacy"]' },
  { label: 'Ospedali', q: '["amenity"="hospital"]' },
  { label: 'Ambulatori', q: '["amenity"~"^(doctors|clinic)$"]' },
  { label: 'Scuole', q: '["amenity"="school"]' },
  { label: 'Asili', q: '["amenity"="kindergarten"]' },
  { label: 'Università', q: '["amenity"="university"]' },
  { label: 'Stazioni', q: '["railway"="station"]' },
  { label: 'Fermate bus', q: '["highway"="bus_stop"]' },
  { label: 'Supermercati', q: '["shop"="supermarket"]' },
  { label: 'Bar e ristoranti', q: '["amenity"~"^(restaurant|bar|cafe)$"]' },
  { label: 'Alloggi', q: '["tourism"~"^(hotel|guest_house|hostel)$"]' },
  { label: 'Musei', q: '["tourism"="museum"]' },
  { label: 'Biblioteche', q: '["amenity"="library"]' },
  { label: 'Ricarica auto', q: '["amenity"="charging_station"]' },
  { label: 'Forze dell\'ordine', q: '["amenity"="police"]' },
  { label: 'Vigili del fuoco', q: '["amenity"="fire_station"]' },
];

const SECTIONS = [
  { id: 'live', label: 'Live' },
  { id: 'demo', label: 'Demografia' },
  { id: 'eco', label: 'Economia' },
  { id: 'hist', label: 'Storico' },
  { id: 'terr', label: 'Territorio' },
  { id: 'info', label: 'Info' },
];

/** Dossier di un comune: tempo reale, demografia, economia, storico, servizi, informazioni. */
@Component({
  selector: 'app-comune-entity',
  imports: [DecimalPipe, LivePanel, DemoPanel, EconomyPanel, HistoryPanel],
  template: `
    @if (c(); as c) {
      <header class="head">
        <div>
          <span class="tag">Comune</span>
          <span class="id mono">ISTAT {{ c.istat }} · {{ c.k }}</span>
        </div>
        <div class="title">
          @if (wiki.hasValue() && wiki.value()?.thumb; as t) {
            <img class="thumb" [src]="t" alt="" />
          }
          <div>
            <h1>{{ c.name }}</h1>
            <p class="muted small mono">{{ provinceName() }} ({{ c.provAcr }}) · {{ regionName() }}</p>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="ghost" (click)="frame()">◎ Inquadra</button>
          <button type="button" class="ghost" (click)="actions.focusProvince(c.prov)">Provincia ↑</button>
          @if (wiki.hasValue() && wiki.value(); as w) {
            <a class="ghost-link" [href]="w.url" target="_blank" rel="noopener">Wikipedia ↗</a>
          }
          @if (facts.hasValue() && facts.value()?.website; as site) {
            <a class="ghost-link" [href]="site" target="_blank" rel="noopener">Sito del comune ↗</a>
          }
        </div>
      </header>

      <nav class="sections mono" aria-label="Sezioni del dossier">
        @for (s of sections; track s.id) {
          <button type="button" (click)="go(s.id)">{{ s.label }}</button>
        }
      </nav>

      <section id="live">
        <h3>Situazione in tempo reale</h3>
        <app-live-panel [lat]="c.y" [lon]="c.x" [comune]="c" [radiusKm]="25" />
      </section>

      <section id="demo">
        <h3>Demografia</h3>
        <app-demo-panel
          [agg]="me()"
          [selfLabel]="c.name"
          [compare]="compare()"
          [ranks]="popRanks()"
          [bm]="detail()?.bm ?? null"
          [bf]="detail()?.bf ?? null"
          [cmpM]="regionPyramid().m"
          [cmpF]="regionPyramid().f"
          [cmpLabel]="regionName()"
          [years]="popYears()"
          [values]="detail()?.ps ?? []"
        />
      </section>

      <section id="eco">
        <h3>Economia</h3>
        <app-economy-panel
          [agg]="me()"
          [selfLabel]="c.name"
          [compare]="compare()"
          [ranks]="incomeRanks()"
          [bands]="detail()?.ib ?? null"
          [comp]="detail()?.comp ?? null"
          [years]="incomeYears()"
          [values]="detail()?.is ?? []"
          [cmpValues]="regionIncomeSeries()"
          [cmpLabel]="regionName()"
        />
      </section>

      <section id="hist">
        <h3>Storico</h3>
        <app-history-panel [lat]="c.y" [lon]="c.x" [area]="quakeArea()" [minMag]="2" />
      </section>

      <section id="terr">
        <h3>Territorio</h3>
        <dl class="props">
          <dt>Superficie</dt>
          <dd>{{ c.area | number: '1.0-2' }} km²</dd>
          @if (facts.hasValue() && facts.value(); as f) {
            @if (f.elevation !== null) {
              <dt>Altitudine</dt>
              <dd>{{ f.elevation }} m s.l.m.</dd>
            }
            @if (f.postcodes) {
              <dt>CAP</dt>
              <dd>{{ f.postcodes }}</dd>
            }
          }
          <dt>Coordinate</dt>
          <dd>{{ c.y | number: '1.4-4' }}, {{ c.x | number: '1.4-4' }}</dd>
          <dt>Dataset su dati.gov.it</dt>
          <dd>
            @if (datasets.hasValue()) {
              {{ datasets.value().total | number }}
            } @else {
              …
            }
          </dd>
        </dl>

        <div class="osm">
          <div class="osm-head">
            <span class="label">Servizi censiti su OpenStreetMap</span>
            @if (!osmOn()) {
              <button type="button" class="ghost" (click)="osmOn.set(true)">Censisci</button>
            }
          </div>
          @if (osmOn()) {
            @if (osm.hasValue() && osm.value().length) {
              <div class="osm-grid">
                @for (o of osmRows(); track o.label) {
                  <div>
                    <b class="mono">{{ o.n | number }}</b>
                    <span>{{ o.label }}</span>
                    @if (o.per10k !== null) {
                      <small class="mono">{{ o.per10k | number: '1.1-1' }} / 10k ab</small>
                    }
                  </div>
                }
              </div>
            } @else if (osm.error()) {
              <p class="muted small">
                Overpass non risponde (server pubblici spesso sovraccarichi).
                <button type="button" class="link" (click)="osm.reload()">Riprova</button>
              </p>
            } @else if (osm.hasValue()) {
              <p class="muted small">Confine del comune non trovato su OSM.</p>
            } @else {
              <div class="skeleton" style="height: 120px"></div>
              <p class="note">Interrogazione di OpenStreetMap in corso: può richiedere fino a 30 secondi.</p>
            }
          } @else {
            <p class="note">Conta farmacie, scuole, stazioni, servizi… dai dati OSM (ODbL). Richiesta pesante: solo su comando.</p>
          }
        </div>
      </section>

      <section id="info">
        <h3>Informazioni</h3>
        @if (facts.hasValue() && facts.value(); as f) {
          <dl class="props">
            @if (f.mayor) {
              <dt>Sindaco</dt>
              <dd>{{ f.mayor }}</dd>
            }
            @if (f.demonym) {
              <dt>Abitanti</dt>
              <dd>{{ f.demonym }}</dd>
            }
            @if (f.patron) {
              <dt>Patrono</dt>
              <dd>{{ f.patron }}</dd>
            }
          </dl>
        }
        @if (facts.error()) {
          <p class="muted small">
            Wikidata non risponde (limite di richieste del servizio).
            <button type="button" class="link" (click)="facts.reload()">Riprova</button>
          </p>
        }
        @if (wiki.hasValue() && wiki.value(); as w) {
          <p class="extract">{{ w.extract }}</p>
          <p class="note">Testo da Wikipedia (CC BY-SA 4.0) · dati da Wikidata (CC0).</p>
        } @else if (wiki.isLoading() || facts.isLoading()) {
          <div class="skeleton" style="height: 90px"></div>
        }
      </section>
    } @else if (census.ready()) {
      <p class="muted">Comune non trovato.</p>
    } @else {
      <div class="skeleton" style="height: 300px"></div>
    }
  `,
  styleUrl: './entity.css',
  styles: `
    .thumb {
      width: 64px;
      height: 64px;
      object-fit: cover;
      border-radius: var(--radius);
      border: 1px solid var(--line-strong);
    }
    .sections {
      position: sticky;
      top: -14px;
      z-index: 2;
      display: flex;
      gap: 2px;
      margin: 0 -14px;
      padding: 6px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--line);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .sections button {
      padding: 3px 8px;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: none;
      color: var(--muted);
      font: inherit;
      font-size: 0.68rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      white-space: nowrap;
    }
    .sections button:hover {
      color: var(--accent);
      border-color: var(--line-strong);
    }
    section {
      display: grid;
      gap: 10px;
      scroll-margin-top: 40px;
    }
    section h3 {
      margin: 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
      color: var(--accent);
    }
    .osm {
      display: grid;
      gap: 8px;
    }
    .osm-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .osm-head .label {
      margin: 0;
    }
    .osm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 1px;
      background: var(--line);
      border: 1px solid var(--line);
    }
    .osm-grid div {
      display: grid;
      padding: 6px 8px;
      background: var(--surface);
    }
    .osm-grid b {
      color: var(--accent);
      font-size: 1rem;
    }
    .osm-grid span {
      font-size: 0.72rem;
    }
    .osm-grid small {
      font-size: 0.62rem;
      color: var(--muted);
    }
    .extract {
      font-size: 0.85rem;
      line-height: 1.55;
      margin: 0;
    }
    .note {
      margin: 0;
      font-size: 0.7rem;
      color: var(--faint);
    }
  `,
})
export class ComuneEntity {
  readonly code = input.required<string>();

  protected census = inject(CensusService);
  private api = inject(ApisService);
  private geo = inject(GeoService);
  private host = inject(ElementRef<HTMLElement>);
  protected actions = inject(ActionsService);
  protected readonly sections = SECTIONS;
  protected osmOn = signal(false);
  constructor() {
    this.census.load();
  }

  protected c = computed<Comune | null>(() => this.census.comuni().get(this.code()) ?? null);

  protected regionName = computed(() => regionByCode(this.c()?.reg)?.name ?? '');
  protected provinceName = computed(() => {
    const p = this.c()?.prov;
    return this.geo.provinces.hasValue()
      ? (this.geo.provinces.value().features.find(f => f.properties.prov_istat_code_num === p)?.properties.prov_name ?? '')
      : '';
  });

  protected popYears = computed(() => this.census.meta()?.popYears ?? []);
  protected incomeYears = computed(() => this.census.meta()?.incomeYears ?? []);

  // ---------- dettagli della regione (piramidi, fasce, serie) ----------
  private regionDetail = rxResource({
    params: () => this.c()?.reg,
    stream: ({ params: reg }) => this.census.detailOf(reg),
  });
  protected detail = computed(() => (this.regionDetail.hasValue() ? (this.regionDetail.value()[this.code()] ?? null) : null));

  protected regionPyramid = computed(() => {
    const all = this.regionDetail.hasValue() ? Object.values(this.regionDetail.value()) : [];
    return all.length ? { m: sumArrays(all.map(d => d.bm)), f: sumArrays(all.map(d => d.bf)) } : { m: null, f: null };
  });

  /** Reddito medio della regione per anno, pesato con i contribuenti attuali di ogni comune. */
  protected regionIncomeSeries = computed(() => {
    const c = this.c();
    if (!c || !this.regionDetail.hasValue()) return null;
    const det = this.regionDetail.value();
    const years = this.incomeYears();
    const list = this.census.byRegion().get(c.reg) ?? [];
    return years.map((_, i) => {
      let w = 0;
      let s = 0;
      for (const x of list) {
        const v = det[x.k]?.is?.[i];
        if (v && x.taxpayers) {
          s += v * x.taxpayers;
          w += x.taxpayers;
        }
      }
      return w ? s / w : null;
    });
  });

  // ---------- aggregati e confronti ----------
  protected me = computed(() => single(this.c()!));
  protected compare = computed(() => {
    const c = this.c();
    if (!c) return [];
    return [
      { label: c.provAcr, agg: this.census.provinceAggregate(c.prov) },
      { label: this.regionName().slice(0, 12), agg: this.census.regionAggregate(c.reg) },
      { label: 'Italia', agg: this.census.italy() },
    ];
  });

  protected popRanks = computed(() => this.ranks(c => c.pop, 'per popolazione'));
  protected incomeRanks = computed(() => this.ranks(c => c.inc, 'per reddito'));

  private ranks(value: (c: Comune) => number | null, what: string) {
    const c = this.c();
    if (!c) return [];
    const out = [
      { label: `${what} in provincia`, r: rankOf(this.census.byProvince().get(c.prov) ?? [], c.k, value) },
      { label: 'in regione', r: rankOf(this.census.byRegion().get(c.reg) ?? [], c.k, value) },
      { label: 'in Italia', r: rankOf(this.census.list(), c.k, value) },
    ];
    return out.filter(x => x.r).map(x => ({ label: x.label, rank: x.r!.rank, of: x.r!.of }));
  }

  protected quakeArea = computed<QuakeArea>(() => {
    const c = this.c()!;
    return { lat: c.y, lon: c.x, radiusKm: 25 };
  });

  // ---------- fonti esterne ----------
  protected facts = rxResource({
    params: () => this.c()?.k,
    stream: ({ params: k }) => this.api.wikiFacts(k),
  });

  /** Voce di Wikipedia: il titolo da Wikidata se c'è, altrimenti il nome del comune (anche se Wikidata fallisce). */
  protected wiki = rxResource({
    params: () => {
      if (this.facts.isLoading()) return undefined;
      const title = this.facts.hasValue() ? this.facts.value()?.title : null;
      return title ?? this.c()?.name;
    },
    stream: ({ params: title }) => (title ? this.api.wikiSummary(title) : of(null)),
  });

  protected datasets = rxResource({
    params: () => this.c()?.name,
    stream: ({ params: name }) => this.api.datasets(name, 0, 1),
  });

  protected osm = rxResource({
    params: () => (this.osmOn() ? this.c()?.k : undefined),
    stream: ({ params: k }) => this.api.osmCounts(k, OSM.map(o => o.q)),
  });

  protected osmRows = computed(() => {
    const counts = this.osm.hasValue() ? this.osm.value() : [];
    const pop = this.c()?.pop ?? 0;
    return OSM.map((o, i) => ({ label: o.label, n: counts[i] ?? 0, per10k: pop ? ((counts[i] ?? 0) / pop) * 10_000 : null }));
  });

  protected frame() {
    const c = this.c();
    if (c) this.actions.focusComune(c);
  }

  protected go(id: string) {
    (this.host.nativeElement as HTMLElement).querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
