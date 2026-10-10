import { Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { rxResource } from '@angular/core/rxjs-interop';
import { forkJoin, map, of } from 'rxjs';
import { ActionsService } from '../core/actions.service';
import { Comune, ComuneDetail, aggregate, sumArrays } from '../core/census';
import { CensusService } from '../core/census.service';
import { Compare, DemoPanel, Rank } from './panels/demo-panel';
import { EconomyPanel } from './panels/economy-panel';
import { HistoryPanel, QuakeArea } from './panels/history-panel';
import { LivePanel } from './panels/live-panel';

type SortKey = 'pop' | 'growth' | 'decline' | 'density' | 'income' | 'old' | 'young';

const SORTS: { id: SortKey; label: string; value: (c: Comune) => number | null; dir: 1 | -1 }[] = [
  { id: 'pop', label: 'Più popolosi', value: c => c.pop, dir: -1 },
  { id: 'growth', label: 'Crescono di più', value: c => growth(c), dir: -1 },
  { id: 'decline', label: 'Calano di più', value: c => growth(c), dir: 1 },
  { id: 'density', label: 'Più densi', value: c => (c.pop && c.area ? c.pop / c.area : null), dir: -1 },
  { id: 'income', label: 'Reddito più alto', value: c => c.inc, dir: -1 },
  { id: 'old', label: 'Più anziani', value: c => c.ageMean, dir: -1 },
  { id: 'young', label: 'Più giovani', value: c => c.ageMean, dir: 1 },
];

function growth(c: Comune) {
  return c.pop && c.pop20 ? ((c.pop - c.pop20) / c.pop20) * 100 : null;
}

/**
 * Dossier di un territorio (provincia, regione, Italia): aggregati dei suoi comuni, classifica interna,
 * tempo reale al capoluogo, demografia ed economia aggregate, storico.
 */
@Component({
  selector: 'app-territory-dossier',
  imports: [DecimalPipe, LivePanel, DemoPanel, EconomyPanel, HistoryPanel],
  template: `
    @if (capital(); as cap) {
      <section>
        <h3>Situazione in tempo reale · {{ cap.name }}</h3>
        <app-live-panel [lat]="cap.y" [lon]="cap.x" [group]="comuni()" [radiusKm]="liveRadius()" />
      </section>
    }

    <section>
      <h3>Comuni · {{ comuni().length | number }}</h3>
      <div class="sorts">
        @for (s of sorts; track s.id) {
          <button type="button" class="ghost" [class.on]="sort() === s.id" (click)="sort.set(s.id)">{{ s.label }}</button>
        }
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Comune</th>
            <th>Abitanti</th>
            <th>Var. 5a</th>
            <th>Età</th>
            <th>Reddito</th>
          </tr>
        </thead>
        <tbody>
          @for (c of top(); track c.k; let i = $index) {
            <tr (click)="actions.focusComune(c)" tabindex="0" (keydown.enter)="actions.focusComune(c)">
              <td class="mono muted">{{ i + 1 }}</td>
              <td class="name">{{ c.name }} <span class="muted mono">{{ c.provAcr }}</span></td>
              <td class="mono">{{ c.pop | number }}</td>
              <td class="mono" [class.up]="(g(c) ?? 0) > 0" [class.down]="(g(c) ?? 0) < 0">{{ signed(g(c)) }}</td>
              <td class="mono">{{ c.ageMean | number: '1.1-1' }}</td>
              <td class="mono">{{ c.inc | number: '1.0-0' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>

    <section>
      <h3>Demografia</h3>
      <app-demo-panel
        [agg]="agg()"
        [selfLabel]="label()"
        [compare]="compare()"
        [ranks]="ranks()"
        [bm]="pyramid().m"
        [bf]="pyramid().f"
        [years]="popYears()"
        [values]="popSeries()"
      />
    </section>

    <section>
      <h3>Economia</h3>
      <app-economy-panel
        [agg]="agg()"
        [selfLabel]="label()"
        [compare]="compare()"
        [ranks]="incomeRanks()"
        [bands]="bands()"
        [comp]="comp()"
        [years]="incomeYears()"
        [values]="incomeSeries()"
      />
    </section>

    @if (capital(); as cap) {
      <section>
        <h3>Storico</h3>
        <app-history-panel [lat]="cap.y" [lon]="cap.x" [area]="quakeArea()" [minMag]="minMag()" />
      </section>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 18px;
    }
    section {
      display: grid;
      gap: 10px;
    }
    section h3 {
      margin: 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
      color: var(--accent);
    }
    .sorts {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .sorts .ghost {
      font-size: 0.7rem;
      padding: 2px 7px;
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    .tbl th,
    .tbl td {
      padding: 4px 5px;
      border-bottom: 1px solid var(--line);
      text-align: right;
      white-space: nowrap;
    }
    .tbl th {
      font-size: 0.6rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
    }
    .tbl th:nth-child(2),
    .tbl td.name {
      text-align: left;
    }
    .tbl td.name {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tbl tbody tr {
      cursor: pointer;
    }
    .tbl tbody tr:hover {
      background: var(--hover);
    }
    .tbl tbody tr:focus-visible {
      outline: 1px solid var(--accent);
    }
    .up {
      color: var(--ok);
    }
    .down {
      color: var(--danger);
    }
  `,
})
export class TerritoryDossier {
  readonly comuni = input.required<Comune[]>();
  readonly label = input.required<string>();
  readonly capital = input<Comune | null>(null);
  readonly compare = input<Compare[]>([]);
  readonly ranks = input<Rank[]>([]);
  readonly incomeRanks = input<Rank[]>([]);
  /** regioni i cui dettagli servono (piramidi, fasce, serie) */
  readonly regions = input.required<number[]>();
  readonly quakeArea = input.required<QuakeArea>();
  readonly minMag = input(3);
  readonly liveRadius = input(40);

  private census = inject(CensusService);
  protected actions = inject(ActionsService);
  protected readonly sorts = SORTS;
  protected sort = signal<SortKey>('pop');
  protected readonly g = growth;

  protected popYears = computed(() => this.census.meta()?.popYears ?? []);
  protected incomeYears = computed(() => this.census.meta()?.incomeYears ?? []);

  protected agg = computed(() => aggregate(this.comuni()));

  protected top = computed(() => {
    const s = SORTS.find(x => x.id === this.sort())!;
    // per le variazioni si escludono i comuni minuscoli, dove pochi residenti fanno percentuali estreme
    const list = this.comuni().filter(c => s.value(c) !== null && (s.id !== 'growth' && s.id !== 'decline' ? true : (c.pop ?? 0) >= 1000));
    return list.sort((a, b) => s.dir * (s.value(a)! - s.value(b)!)).slice(0, 15);
  });

  // ---------- dettagli delle regioni coinvolte ----------
  private details = rxResource({
    params: () => this.regions(),
    stream: ({ params: regs }) =>
      regs.length
        ? forkJoin(regs.map(r => this.census.detailOf(r))).pipe(map(list => Object.assign({}, ...list) as Record<string, ComuneDetail>))
        : of({} as Record<string, ComuneDetail>),
  });

  private mine = computed(() => {
    const det = this.details.hasValue() ? this.details.value() : {};
    return this.comuni()
      .map(c => ({ c, d: det[c.k] }))
      .filter(x => !!x.d);
  });

  protected pyramid = computed(() => {
    const list = this.mine();
    return list.length ? { m: sumArrays(list.map(x => x.d.bm)), f: sumArrays(list.map(x => x.d.bf)) } : { m: null, f: null };
  });

  protected bands = computed(() => {
    const list = this.mine();
    return list.length ? sumArrays(list.map(x => x.d.ib)) : null;
  });

  protected comp = computed(() => {
    const list = this.mine();
    return list.length ? sumArrays(list.map(x => x.d.comp)) : null;
  });

  /** Popolazione per anno: somma dei soli comuni con la serie completa, per non falsare l'andamento. */
  protected popSeries = computed(() => {
    const n = this.popYears().length;
    const full = this.mine().filter(x => x.d.ps.length === n && x.d.ps.every(v => v !== null));
    return full.length ? sumArrays(full.map(x => x.d.ps)) : [];
  });

  /** Reddito medio per anno, pesato con i contribuenti attuali. */
  protected incomeSeries = computed(() =>
    this.incomeYears().map((_, i) => {
      let s = 0;
      let w = 0;
      for (const { c, d } of this.mine()) {
        const v = d.is?.[i];
        if (v && c.taxpayers) {
          s += v * c.taxpayers;
          w += c.taxpayers;
        }
      }
      return w ? s / w : null;
    }),
  );

  protected signed(v: number | null) {
    return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
  }
}
