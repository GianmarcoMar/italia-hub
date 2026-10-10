import { Component, computed, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApisService } from '../../core/apis.service';
import { depthColor } from '../../core/format';
import { perYear } from '../../core/history';
import { Bar, BarChart } from '../../shared/bar-chart';
import { ChartSeries, LineChart } from '../../shared/line-chart';

const MONTHS = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];
const FIRST_YEAR = 1985;

export type QuakeArea = { lat: number; lon: number; radiusKm: number } | { box: [number, number, number, number] };

/**
 * Serie storiche di un luogo: clima mensile 1991-oggi (NASA POWER) e terremoti dal 1985 (catalogo INGV).
 */
@Component({
  selector: 'app-history-panel',
  imports: [DatePipe, DecimalPipe, BarChart, LineChart],
  template: `
    <!-- clima -->
    <div class="detail">
      <span class="label">Clima dal 1991 · NASA POWER (MERRA-2, ~50 km)</span>
      @if (climate.hasValue() && climate.value(); as c) {
        @let s = climateStats();
        <div class="tiles three">
          <div class="tile">
            <span class="label">Tendenza</span>
            <div class="big"><b class="mono">{{ signed(c.trendPerDecade) }}</b> <small>°C / 10 anni</small></div>
          </div>
          <div class="tile">
            <span class="label">Ultimi 5 anni</span>
            <div class="big"><b class="mono">{{ signed(s.anomaly) }}</b> <small>°C vs 1991–2000</small></div>
          </div>
          <div class="tile">
            <span class="label">Anno più caldo</span>
            <div class="big"><b class="mono">{{ s.warmest?.year }}</b> <small>{{ s.warmest?.t | number: '1.1-1' }}°</small></div>
          </div>
        </div>
        <app-line-chart [series]="tempSeries()" [height]="160" [yFormat]="deg" ariaLabel="Temperatura media annua" />
        <span class="label">Normali mensili 1991–2020 · pioggia mm</span>
        <app-bar-chart [bars]="rainBars()" [height]="110" [format]="mm" [maxLabels]="12" ariaLabel="Pioggia media mensile" />
        <p class="note">
          Temperatura media annua {{ s.mean | number: '1.1-1' }}° · pioggia media {{ s.rain | number: '1.0-0' }} mm/anno ·
          anno più piovoso {{ s.wettest?.year }} ({{ s.wettest?.p | number: '1.0-0' }} mm)
        </p>
      } @else if (climate.error()) {
        <p class="sub">Serie climatica non disponibile.</p>
      } @else if (climate.hasValue()) {
        <p class="sub">Nessun dato climatico per questo punto.</p>
      } @else {
        <div class="skeleton" style="height: 200px"></div>
      }
    </div>

    <!-- sismicità storica -->
    <div class="detail">
      <span class="label">Terremoti dal {{ firstYear }} · M{{ minMag() }}+ · INGV</span>
      @if (quakes.hasValue()) {
        @let s = quakeStats();
        <div class="tiles three">
          <div class="tile">
            <span class="label">Eventi</span>
            <div class="big"><b class="mono">{{ s.count | number }}</b></div>
          </div>
          <div class="tile">
            <span class="label">Più forte</span>
            <div class="big"><b class="mono">{{ s.max ? 'M' + (s.max.mag | number: '1.1-1') : '—' }}</b></div>
            <span class="sub">{{ s.max ? (s.max.time | date: 'd MMM y') : '' }}</span>
          </div>
          <div class="tile">
            <span class="label">M4+</span>
            <div class="big"><b class="mono">{{ s.strong }}</b></div>
            <span class="sub">ultimo {{ s.lastStrong ? (s.lastStrong.time | date: 'y') : '—' }}</span>
          </div>
        </div>
        @if (s.count) {
          <app-bar-chart [bars]="yearBars()" [height]="120" [maxLabels]="8" ariaLabel="Terremoti per anno" />
          <span class="label">I più forti</span>
          <ul class="rel">
            @for (q of s.top; track q.id) {
              <li class="mono">
                <span [style.color]="color(q.depthKm)">M{{ q.mag | number: '1.1-1' }}</span>
                <span class="txt">{{ q.place }}</span>
                <span class="muted">{{ q.time | date: 'dd/MM/yyyy' }}</span>
              </li>
            }
          </ul>
        }
      } @else if (quakes.error()) {
        <p class="sub">Catalogo INGV non disponibile.</p>
      } @else {
        <div class="skeleton" style="height: 160px"></div>
      }
    </div>
  `,
  styleUrl: './panels.css',
})
export class HistoryPanel {
  readonly lat = input.required<number>();
  readonly lon = input.required<number>();
  readonly area = input.required<QuakeArea>();
  readonly minMag = input(2.5);

  private api = inject(ApisService);
  protected readonly firstYear = FIRST_YEAR;
  protected readonly color = depthColor;
  protected readonly deg = (v: number) => `${v.toLocaleString('it-IT', { maximumFractionDigits: 1 })}°`;
  protected readonly mm = (v: number) => `${Math.round(v)} mm`;

  protected climate = rxResource({
    // la cella di POWER è di ~0,5°: arrotondare evita richieste diverse per punti vicini
    params: () => ({ lat: Math.round(this.lat() * 10) / 10, lon: Math.round(this.lon() * 10) / 10 }),
    stream: ({ params: p }) => this.api.climate(p.lat, p.lon),
  });

  protected quakes = rxResource({
    params: () => ({ area: this.area(), m: this.minMag() }),
    stream: ({ params: p }) => this.api.quakeHistory(p.area, p.m),
  });

  protected signed(v: number | null | undefined) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${v.toLocaleString('it-IT', { maximumFractionDigits: 2 })}`;
  }

  protected climateStats = computed(() => {
    const c = this.climate.hasValue() ? this.climate.value() : null;
    const ys = c?.years ?? [];
    const base = ys.filter(y => y.year >= 1991 && y.year <= 2000);
    const last = ys.slice(-5);
    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
    return {
      anomaly: base.length && last.length ? mean(last.map(y => y.t)) - mean(base.map(y => y.t)) : null,
      warmest: ys.reduce<(typeof ys)[number] | null>((m, y) => (!m || y.t > m.t ? y : m), null),
      wettest: ys.reduce<(typeof ys)[number] | null>((m, y) => (!m || y.p > m.p ? y : m), null),
      mean: mean(ys.map(y => y.t)),
      rain: mean(ys.map(y => y.p)),
    };
  });

  protected tempSeries = computed<ChartSeries[]>(() => {
    const c = this.climate.hasValue() ? this.climate.value() : null;
    if (!c) return [];
    const pts = c.years.map(y => ({ x: y.year, y: y.t }));
    // retta di tendenza, per leggere il riscaldamento a colpo d'occhio
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    const k = (c.trendPerDecade ?? 0) / 10;
    return [
      { name: 'Media annua', color: 'var(--warn)', points: pts },
      { name: 'Tendenza', color: 'var(--muted)', points: [pts[0], pts[n - 1]].map(p => ({ x: p.x, y: my + k * (p.x - mx) })) },
    ];
  });

  protected rainBars = computed<Bar[]>(() => {
    const c = this.climate.hasValue() ? this.climate.value() : null;
    return (c?.normals ?? []).map(n => ({ label: MONTHS[n.month - 1], value: Number.isFinite(n.p) ? n.p : 0, color: '#38bdf8' }));
  });

  protected quakeStats = computed(() => {
    const list = this.quakes.hasValue() ? this.quakes.value() : [];
    const sorted = [...list].sort((a, b) => b.mag - a.mag);
    const strong = list.filter(q => q.mag >= 4);
    return {
      count: list.length,
      max: sorted[0] ?? null,
      top: sorted.slice(0, 6),
      strong: strong.length,
      lastStrong: strong.reduce<(typeof strong)[number] | null>((m, q) => (!m || q.time > m.time ? q : m), null),
    };
  });

  protected yearBars = computed<Bar[]>(() => {
    const list = this.quakes.hasValue() ? this.quakes.value() : [];
    return perYear(list, FIRST_YEAR, new Date().getFullYear()).map(y => ({ label: String(y.year), value: y.n }));
  });
}
