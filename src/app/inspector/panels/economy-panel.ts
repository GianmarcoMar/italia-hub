import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Aggregate } from '../../core/census';
import { Bar, BarChart } from '../../shared/bar-chart';
import { ChartSeries, LineChart } from '../../shared/line-chart';
import { Compare, Rank } from './demo-panel';

const BANDS = ['≤10k', '10–15k', '15–26k', '26–55k', '55–75k', '75–120k', '>120k'];
const COMP = [
  { label: 'Lavoro dipendente', color: '#38bdf8' },
  { label: 'Pensioni', color: '#a78bfa' },
  { label: 'Lavoro autonomo', color: '#f5a524' },
  { label: 'Altro', color: '#64748b' },
];

const fmt = (v: number | null, d = 0) => (v === null ? '—' : v.toLocaleString('it-IT', { maximumFractionDigits: d }));

/**
 * Redditi IRPEF (MEF) di un comune o di un territorio: reddito medio e variazioni, distribuzione dei
 * contribuenti per fascia, composizione dei redditi, serie dal 2014.
 */
@Component({
  selector: 'app-economy-panel',
  imports: [DecimalPipe, BarChart, LineChart],
  template: `
    @let a = agg();
    <div class="tiles three">
      <div class="tile">
        <span class="label">Reddito medio 2024</span>
        <div class="big"><b class="mono">{{ a.inc | number: '1.0-0' }}</b> <small>€</small></div>
        <span class="sub">per contribuente</span>
      </div>
      <div class="tile">
        <span class="label">dal 2019</span>
        <div class="big"><b class="mono">{{ signed(a.incChange5) }}</b> <small>%</small></div>
        <span class="sub">dal 2014 {{ signed(a.incChange10) }}%</span>
      </div>
      <div class="tile">
        <span class="label">Contribuenti</span>
        <div class="big"><b class="mono">{{ a.taxpayers | number }}</b></div>
        <span class="sub">{{ a.pop ? ((a.taxpayers / a.pop) * 100 | number: '1.0-0') : '—' }}% dei residenti</span>
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
            <th>Reddito medio</th>
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

    @if (bandBars().length) {
      <div class="detail">
        <span class="label">Contribuenti per fascia di reddito complessivo · % · 2024</span>
        <app-bar-chart [bars]="bandBars()" [height]="130" [format]="pct" ariaLabel="Contribuenti per fascia di reddito" />
      </div>
    }

    @if (composition(); as c) {
      <div class="detail">
        <span class="label">Composizione dei redditi dichiarati</span>
        <div class="stack-bar">
          @for (s of c; track s.label) {
            <i [style.width.%]="s.pct" [style.background]="s.color" [title]="s.label + ' ' + s.pct.toFixed(1) + '%'"></i>
          }
        </div>
        <div class="legend-row">
          @for (s of c; track s.label) {
            <span><i [style.background]="s.color"></i>{{ s.label }} {{ s.pct | number: '1.0-0' }}%</span>
          }
        </div>
      </div>
    }

    @if (series().length) {
      <div class="detail">
        <span class="label">Reddito medio per anno d'imposta · €</span>
        <app-line-chart [series]="series()" [height]="170" [yFormat]="eur" ariaLabel="Reddito medio per anno" />
      </div>
    }
    <p class="note">Fonte: MEF Dipartimento Finanze, dichiarazioni IRPEF per comune (CC BY 3.0 IT). Valori nominali.</p>
  `,
  styleUrl: './panels.css',
})
export class EconomyPanel {
  readonly agg = input.required<Aggregate>();
  readonly selfLabel = input('Qui');
  readonly compare = input<Compare[]>([]);
  readonly ranks = input<Rank[]>([]);
  /** contribuenti per fascia (7) */
  readonly bands = input<number[] | null>(null);
  /** ammontari: dipendente, pensione, autonomo, totale */
  readonly comp = input<number[] | null>(null);
  readonly years = input<number[]>([]);
  readonly values = input<(number | null)[]>([]);
  /** serie di confronto (es. la regione) */
  readonly cmpValues = input<(number | null)[] | null>(null);
  readonly cmpLabel = input('');

  protected readonly pct = (v: number) => `${v.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
  protected readonly eur = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 0 });

  protected signed(v: number | null) {
    return v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 1)}`;
  }

  protected rows = computed(() => {
    const me = this.agg();
    const others = this.compare().map(c => c.agg);
    const line = (label: string, f: (a: Aggregate) => number | null, d = 0, suffix = '') => ({
      label,
      me: fmt(f(me), d) + suffix,
      others: others.map(o => fmt(f(o), d) + suffix),
    });
    return [
      line('2024 (€)', a => a.inc),
      line('2019 (€)', a => a.inc19),
      line('2014 (€)', a => a.inc14),
      line('Variazione 2019–24', a => a.incChange5, 1, '%'),
    ];
  });

  protected bandBars = computed<Bar[]>(() => {
    const b = this.bands();
    if (!b?.length) return [];
    const tot = b.reduce((x, y) => x + y, 0) || 1;
    return b.map((v, i) => ({ label: BANDS[i], value: (v / tot) * 100 }));
  });

  protected composition = computed(() => {
    const c = this.comp();
    if (!c || !c[3]) return null;
    const [dip, pen, aut, tot] = c;
    const other = Math.max(0, tot - dip - pen - aut);
    return [dip, pen, aut, other].map((v, i) => ({ ...COMP[i], pct: (v / tot) * 100 }));
  });

  protected series = computed<ChartSeries[]>(() => {
    const toPts = (vals: (number | null)[]) =>
      this.years()
        .map((x, i) => ({ x, y: vals[i] }))
        .filter((p): p is { x: number; y: number } => p.y !== null && p.y !== undefined);
    const out: ChartSeries[] = [];
    const me = toPts(this.values());
    if (me.length > 1) out.push({ name: this.selfLabel(), color: 'var(--accent)', points: me });
    const cmp = this.cmpValues();
    if (cmp) {
      const pts = toPts(cmp);
      if (pts.length > 1) out.push({ name: this.cmpLabel(), color: '#a78bfa', points: pts });
    }
    return out;
  });
}
