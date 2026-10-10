import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Aggregate } from '../../core/census';
import { ChartSeries, LineChart } from '../../shared/line-chart';
import { Pyramid } from '../../shared/pyramid';

export interface Compare {
  label: string;
  agg: Aggregate;
}

export interface Rank {
  label: string;
  rank: number;
  of: number;
}

const fmt = (v: number | null, d = 1) => (v === null ? '—' : v.toLocaleString('it-IT', { maximumFractionDigits: d }));

/**
 * Demografia ISTAT di un comune o di un territorio: indicatori, confronto con i livelli superiori,
 * piramide delle età e serie annuale della popolazione.
 */
@Component({
  selector: 'app-demo-panel',
  imports: [DecimalPipe, LineChart, Pyramid],
  template: `
    @let a = agg();
    <div class="tiles three">
      <div class="tile">
        <span class="label">Popolazione</span>
        <div class="big"><b class="mono">{{ a.pop | number }}</b></div>
        <span class="delta" [class.up]="(a.popChange ?? 0) > 0" [class.down]="(a.popChange ?? 0) < 0">
          {{ signed(a.popChange) }}% dal 2020
        </span>
      </div>
      <div class="tile">
        <span class="label">Densità</span>
        <div class="big"><b class="mono">{{ a.density | number: '1.0-0' }}</b> <small>ab/km²</small></div>
        <span class="sub">{{ a.area | number: '1.0-0' }} km²</span>
      </div>
      <div class="tile">
        <span class="label">Età media</span>
        <div class="big"><b class="mono">{{ a.ageMean | number: '1.1-1' }}</b> <small>anni</small></div>
        <span class="sub">vecchiaia {{ a.oldAgeIndex | number: '1.0-0' }}</span>
      </div>
      <div class="tile">
        <span class="label">Over 65</span>
        <div class="big"><b class="mono">{{ a.pct65 | number: '1.1-1' }}</b> <small>%</small></div>
        <span class="sub">under 15 {{ a.pct0_14 | number: '1.1-1' }}%</span>
      </div>
      <div class="tile">
        <span class="label">Stranieri</span>
        <div class="big"><b class="mono">{{ a.pctForeign | number: '1.1-1' }}</b> <small>%</small></div>
        <span class="sub">{{ a.foreign | number }} residenti</span>
      </div>
      <div class="tile">
        <span class="label">Donne ogni 100 uomini</span>
        <div class="big"><b class="mono">{{ (a.male ? (a.female / a.male) * 100 : null) | number: '1.0-0' }}</b></div>
        <span class="sub">
          @if (a.comuni > 1) {
            {{ a.comuni | number }} comuni
          } @else {
            al 1° gennaio 2025
          }
        </span>
      </div>
    </div>

    @if (ranks().length) {
      <div class="ranks">
        @for (r of ranks(); track r.label) {
          <span>{{ r.label }} <b>{{ r.rank }}°</b> su {{ r.of | number }}</span>
        }
      </div>
    }

    @if (compare().length) {
      <table class="cmp">
        <thead>
          <tr>
            <th>Indicatore</th>
            <th>{{ selfLabel() }}</th>
            @for (c of compare(); track c.label) {
              <th>{{ c.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.label) {
            <tr>
              <td>{{ row.label }}</td>
              <td class="me">{{ row.me }}</td>
              @for (v of row.others; track $index) {
                <td>{{ v }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    }

    @if (bm() && bf()) {
      <div class="detail">
        <span class="label">Piramide delle età · 2025</span>
        <app-pyramid [m]="bm()!" [f]="bf()!" [compareM]="cmpM()" [compareF]="cmpF()" [compareLabel]="cmpLabel()" />
      </div>
    }

    @if (series().length) {
      <div class="detail">
        <span class="label">Popolazione al 1° gennaio · ISTAT</span>
        <app-line-chart [series]="series()" [height]="170" [yFormat]="int" ariaLabel="Popolazione residente per anno" />
      </div>
    }
    <p class="note">Fonte: ISTAT, popolazione residente al 1° gennaio (POSAS, STRASA), CC BY 4.0.</p>
  `,
  styleUrl: './panels.css',
})
export class DemoPanel {
  readonly agg = input.required<Aggregate>();
  readonly selfLabel = input('Qui');
  readonly compare = input<Compare[]>([]);
  readonly ranks = input<Rank[]>([]);
  readonly bm = input<number[] | null>(null);
  readonly bf = input<number[] | null>(null);
  readonly cmpM = input<number[] | null>(null);
  readonly cmpF = input<number[] | null>(null);
  readonly cmpLabel = input('');
  /** popolazione per anno */
  readonly years = input<number[]>([]);
  readonly values = input<(number | null)[]>([]);

  protected readonly int = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 0 });

  protected signed(v: number | null) {
    return v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`;
  }

  protected rows = computed(() => {
    const me = this.agg();
    const others = this.compare().map(c => c.agg);
    const line = (label: string, f: (a: Aggregate) => number | null, d = 1, suffix = '') => ({
      label,
      me: fmt(f(me), d) + suffix,
      others: others.map(o => fmt(f(o), d) + suffix),
    });
    return [
      line('Variazione 2020–25', a => a.popChange, 1, '%'),
      line('Densità (ab/km²)', a => a.density, 0),
      line('Età media', a => a.ageMean),
      line('Over 65', a => a.pct65, 1, '%'),
      line('Under 15', a => a.pct0_14, 1, '%'),
      line('Indice di vecchiaia', a => a.oldAgeIndex, 0),
      line('Stranieri', a => a.pctForeign, 1, '%'),
    ];
  });

  protected series = computed<ChartSeries[]>(() => {
    const pts = this.years()
      .map((x, i) => ({ x, y: this.values()[i] }))
      .filter((p): p is { x: number; y: number } => p.y !== null && p.y !== undefined);
    return pts.length > 1 ? [{ name: 'Popolazione', color: 'var(--accent)', points: pts }] : [];
  });
}
