import { Component, computed, effect, inject, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActionsService } from '../core/actions.service';
import { CensusService } from '../core/census.service';
import {
  AREAS,
  Insight,
  LEVELS,
  Level,
  VARS,
  VarDef,
  VarId,
  fmt,
  fmtVar,
  varById,
} from '../core/dashboard';
import { DashboardService } from '../core/dashboard.service';
import { MapService } from '../core/map.service';
import { Choropleth } from '../core/analysis';
import { pairs, quantileGroups, relation, spearman, strength } from '../core/stats';
import { UiService } from '../core/ui.service';
import { Bar, BarChart } from '../shared/bar-chart';
import { Scatter, ScatterPoint } from '../shared/scatter';

const GROUPS: { id: Insight['group']; title: string }[] = [
  { id: 'divari', title: 'Divari territoriali' },
  { id: 'demografia', title: 'Demografia' },
  { id: 'relazioni', title: 'Cosa si lega a cosa' },
  { id: 'rischi', title: 'Rischi e tempo reale' },
];

/**
 * Analisi incrociata: conclusioni calcolate dai dati, grafico a dispersione per confrontare due variabili,
 * matrice delle correlazioni, tabelle per macro-area e per dimensione dei comuni.
 * Sta sopra la mappa; le conclusioni e i punti del grafico portano alla mappa e ai dossier.
 */
@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe, Scatter, BarChart],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (ui.analysisMin()) {
      <div class="pill">
        <button type="button" (click)="ui.analysisMin.set(false)" aria-label="Riapri l'analisi incrociata">▲ Analisi incrociata</button>
        <button type="button" class="x" (click)="close()" aria-label="Chiudi l'analisi">✕</button>
      </div>
    } @else {
      <section class="panel" role="dialog" aria-label="Analisi incrociata">
        <header>
          <div>
            <h2>Analisi incrociata</h2>
            <p class="muted small">Le conclusioni sono calcolate dai dati e si aggiornano quando aggiungi nuove fonti.</p>
          </div>
          <div class="btns">
            <button type="button" class="ghost" (click)="ui.analysisMin.set(true)" title="Riduci per vedere la mappa">Riduci</button>
            <button type="button" class="ghost" (click)="close()" aria-label="Chiudi">✕</button>
          </div>
        </header>

        <div class="body">
          @if (!d.ready()) {
            <div class="skeleton" style="height: 120px"></div>
            <p class="muted small">Carico i dati di 7.896 comuni…</p>
          } @else {
            <div class="sources">
              <span class="label">Aggiungi fonti</span>
              @for (s of sources(); track s.id) {
                <button type="button" class="chip" [class.ok]="s.state === 'ready'" [disabled]="s.state === 'loading' || s.state === 'ready'" (click)="s.load()" [title]="s.hint">
                  @switch (s.state) {
                    @case ('ready') {
                      ✓ {{ s.label }}
                    }
                    @case ('loading') {
                      {{ s.label }}… in corso
                    }
                    @case ('error') {
                      {{ s.label }}: errore, riprova
                    }
                    @default {
                      + {{ s.label }}
                    }
                  }
                </button>
              }
            </div>

            <h3>Cosa emerge</h3>
            @for (g of groups(); track g.id) {
              <h4>{{ g.title }}</h4>
              <div class="cards">
                @for (i of g.items; track i.id) {
                  <article [class]="'card ' + i.tone">
                    <h5>{{ i.title }}</h5>
                    <p>{{ i.text }}</p>
                    @if (i.facts?.length) {
                      <p class="facts mono">
                        @for (f of i.facts; track f) {
                          <span>{{ f }}</span>
                        }
                      </p>
                    }
                    @if (i.action; as a) {
                      <button type="button" class="ghost" (click)="run(i)">{{ a.label }}</button>
                    }
                  </article>
                }
              </div>
            }

            <h3 id="esplora">Esplora i dati</h3>
            <div class="controls">
              <div class="seg" role="group" aria-label="Livello">
                @for (l of levels; track l.id) {
                  <button type="button" [class.on]="d.level() === l.id" (click)="setLevel(l.id)">{{ l.label }}</button>
                }
              </div>
              <label>
                <span class="label">Asse X</span>
                <select (change)="d.x.set($any($event.target).value)">
                  @for (v of vars(); track v.id) {
                    <option [value]="v.id" [selected]="v.id === d.x()">{{ v.label }}</option>
                  }
                </select>
              </label>
              <button type="button" class="ghost" (click)="swap()" title="Scambia gli assi" aria-label="Scambia gli assi">⇄</button>
              <label>
                <span class="label">Asse Y</span>
                <select (change)="d.y.set($any($event.target).value)">
                  @for (v of vars(); track v.id) {
                    <option [value]="v.id" [selected]="v.id === d.y()">{{ v.label }}</option>
                  }
                </select>
              </label>
            </div>
            <div class="legend">
              @for (a of areas; track a.id) {
                <button type="button" [class.off]="d.hidden().has(a.id)" (click)="d.toggleArea(a.id)" [attr.aria-pressed]="!d.hidden().has(a.id)">
                  <i [style.background]="a.color"></i>{{ a.name }}
                </button>
              }
            </div>

            <app-scatter
              [points]="points()"
              [xLabel]="label(xDef())"
              [yLabel]="label(yDef())"
              [xLog]="!!xDef().log"
              [yLog]="!!yDef().log"
              [fmtX]="axis(xDef())"
              [fmtY]="axis(yDef())"
              [radius]="d.level() === 'comune' ? 2.2 : 4.5"
              [height]="360"
              [ariaLabel]="'Dispersione: ' + yDef().label + ' contro ' + xDef().label"
              (pick)="open($event)"
            />

            @if (rel(); as r) {
              <p class="stat">
                <b class="mono">ρ = {{ r.rho | number: '1.2-2' }}</b> · correlazione {{ strengthOf(r.rho) }}
                {{ r.rho >= 0 ? 'positiva' : 'negativa' }} · r di Pearson {{ r.r | number: '1.2-2' }} · {{ r.n | number }}
                {{ nounOf(d.level()) }}
                <span class="muted">· R² = {{ r.line.r2 | number: '1.2-2' }} (retta tratteggiata)</span>
              </p>
              <div class="grad">
                <span class="label">{{ yDef().label }} per fascia di «{{ xDef().label.toLowerCase() }}» (dal più basso al più alto)</span>
                <app-bar-chart
                  [bars]="bars()"
                  [height]="150"
                  [format]="axisFull(yDef())"
                  [ref]="mean()"
                  refLabel="media"
                  [maxLabels]="5"
                  [ariaLabel]="'Valore medio di ' + yDef().label + ' per fascia'"
                />
              </div>
            } @else {
              <p class="muted small">Dati insufficienti per questa combinazione. Carica la fonte che serve con «Aggiungi fonti».</p>
            }

            <h3>Matrice delle correlazioni · {{ levelLabel() }}</h3>
            <p class="muted small">ρ di Spearman tra tutte le variabili. Un clic su una cella apre il grafico di quella coppia.</p>
            <div class="matrix-wrap">
              <table class="matrix">
                <thead>
                  <tr>
                    <th></th>
                    @for (c of matrix().vars; track c.id) {
                      <th [title]="c.label">{{ shortLabel(c) }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of matrix().rows; track row.v.id) {
                    <tr>
                      <th [title]="row.v.label">{{ shortLabel(row.v) }}</th>
                      @for (cell of row.cells; track cell.col.id) {
                        <td
                          [style.background]="cell.bg"
                          [class.self]="cell.self"
                          [title]="cell.self ? '' : row.v.label + ' · ' + cell.col.label + ': ρ ' + (cell.rho === null ? 'n.d.' : (cell.rho | number: '1.2-2'))"
                          (click)="!cell.self && cell.rho !== null && pickPair(row.v.id, cell.col.id)"
                        >
                          {{ cell.self ? '' : cell.rho === null ? '–' : (cell.rho | number: '1.2-2') }}
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <h3>Le cinque aree a confronto</h3>
            <div class="matrix-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Abitanti</th>
                    <th>Reddito</th>
                    <th>Età media</th>
                    <th>Over 65</th>
                    <th>Stranieri</th>
                    <th>Var. pop.</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of d.areas(); track a.id) {
                    <tr>
                      <th><i class="dot" [style.background]="a.color"></i>{{ a.name }}</th>
                      <td class="mono">{{ a.agg.pop | number }}</td>
                      <td class="mono">{{ a.agg.inc === null ? '–' : (a.agg.inc | number: '1.0-0') + ' €' }}</td>
                      <td class="mono">{{ a.agg.ageMean === null ? '–' : (a.agg.ageMean | number: '1.1-1') }}</td>
                      <td class="mono">{{ a.agg.pct65 === null ? '–' : (a.agg.pct65 | number: '1.1-1') + '%' }}</td>
                      <td class="mono">{{ a.agg.pctForeign === null ? '–' : (a.agg.pctForeign | number: '1.1-1') + '%' }}</td>
                      <td class="mono" [class.neg]="(a.agg.popChange ?? 0) < 0">{{ a.agg.popChange === null ? '–' : (a.agg.popChange | number: '1.1-1') + '%' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <h3>Comuni per dimensione</h3>
            <div class="matrix-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>Abitanti</th>
                    <th>Comuni</th>
                    <th>% popolazione</th>
                    <th>Hanno perso abitanti</th>
                    <th>Reddito</th>
                    <th>Over 65</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of d.sizes(); track s.label) {
                    <tr>
                      <th>{{ s.label }}</th>
                      <td class="mono">{{ s.comuni | number }}</td>
                      <td class="mono">{{ s.popShare | number: '1.1-1' }}%</td>
                      <td class="mono">{{ s.shrinkingShare === null ? '–' : (s.shrinkingShare | number: '1.0-0') + '%' }}</td>
                      <td class="mono">{{ s.agg.inc === null ? '–' : (s.agg.inc | number: '1.0-0') + ' €' }}</td>
                      <td class="mono">{{ s.agg.pct65 === null ? '–' : (s.agg.pct65 | number: '1.1-1') + '%' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <h3>Come leggere questi risultati</h3>
            <ul class="notes small muted">
              <li>Una correlazione dice che due cose vanno insieme, non che una causa l'altra: dietro possono esserci altri fattori (storia economica, geografia, migrazioni).</li>
              <li>I dati sono aggregati per territorio: un legame tra comuni non vale necessariamente per le singole persone che ci vivono.</li>
              <li>ρ di Spearman misura quanto due classifiche si somigliano (da −1 a +1) ed è poco influenzato dai valori estremi. Con migliaia di comuni quasi ogni correlazione è «significativa»: conta quanto è forte.</li>
              <li>Redditi: anno d'imposta 2024 (MEF), valori nominali, dichiarazioni IRPEF: non comprendono redditi non dichiarati né esenti. Popolazione e stranieri: ISTAT al 1° gennaio 2025.</li>
              <li>Sismicità: catalogo INGV, terremoti M3+ dal 1985, più completo negli anni recenti. Clima: NASA POWER sul punto del capoluogo di regione.</li>
            </ul>
          }
        </div>
      </section>
    }
  `,
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected d = inject(DashboardService);
  protected ui = inject(UiService);
  private mapSvc = inject(MapService);
  private actions = inject(ActionsService);
  private census = inject(CensusService);

  protected readonly levels = LEVELS;
  protected readonly areas = AREAS;

  constructor() {
    this.d.loadCensus();
    // cambiando livello le variabili disponibili cambiano: gli assi si riportano a valori validi
    effect(() => {
      const vars = this.vars();
      untracked(() => {
        if (!vars.length) return;
        const x = this.d.x();
        const y = this.d.y();
        if (!vars.some(v => v.id === x)) this.d.x.set(vars[0].id);
        if (!vars.some(v => v.id === y)) this.d.y.set((vars.find(v => v.id !== this.d.x()) ?? vars[0]).id);
      });
    });
  }

  protected onEscape() {
    if (this.ui.analysisOpen() && !this.ui.analysisMin()) this.ui.analysisMin.set(true);
  }

  protected close() {
    this.ui.analysisOpen.set(false);
    this.ui.analysisMin.set(false);
  }

  protected sources = computed(() => {
    return [
      { id: 'quake', label: 'sismicità storica', hint: 'Catalogo INGV, terremoti M3+ dal 1985 (circa 1,5 MB, 15–30 secondi)', state: this.d.quakeState(), load: () => this.d.loadQuakes() },
      { id: 'climate', label: 'clima delle regioni', hint: 'NASA POWER, 20 richieste, serie dal 1991', state: this.d.climateState(), load: () => this.d.loadClimate() },
      { id: 'alerts', label: 'allerte di oggi', hint: 'Bollettino della Protezione Civile', state: this.d.alertState(), load: () => this.d.loadAlerts() },
    ];
  });

  protected groups = computed(() => {
    const all = this.d.insights();
    return GROUPS.map(g => ({ ...g, items: all.filter(i => i.group === g.id) })).filter(g => g.items.length);
  });

  // ---------- grafico ----------
  protected xDef = computed(() => varById(this.d.x()));
  protected yDef = computed(() => varById(this.d.y()));
  protected levelLabel = computed(() => LEVELS.find(l => l.id === this.d.level())!.label.toLowerCase());

  /** Variabili con dati sufficienti al livello scelto (quelle da caricare a parte compaiono quando arrivano). */
  protected vars = computed<VarDef[]>(() => {
    const level = this.d.level();
    const units = this.d.units()[level];
    return VARS.filter(v => v.levels.includes(level) && units.filter(u => u.v[v.id] != null).length >= Math.min(10, units.length));
  });

  protected points = computed<ScatterPoint[]>(() => {
    const hidden = this.d.hidden();
    const x = this.d.x();
    const y = this.d.y();
    const color = new Map(AREAS.map(a => [a.id, a.color]));
    const out: ScatterPoint[] = [];
    for (const u of this.d.units()[this.d.level()]) {
      const px = u.v[x];
      const py = u.v[y];
      if (hidden.has(u.area) || px == null || py == null) continue;
      out.push({ id: u.id, label: u.sub ? `${u.name} (${u.sub})` : u.name, x: px, y: py, color: color.get(u.area) ?? '#999' });
    }
    return out;
  });

  protected rel = computed(() => relation(this.points().map(p => p.x), this.points().map(p => p.y)));

  protected bars = computed<Bar[]>(() => {
    const pts = this.points();
    const k = this.d.level() === 'region' ? 4 : 5;
    const groups = quantileGroups(pts.map(p => p.x), pts.map(p => p.y), k);
    const def = this.xDef();
    return groups.map(g => ({ label: `${fmt(g.from, def.digits)}–${fmt(g.to, def.digits)}`, value: g.y }));
  });

  protected mean = computed(() => {
    const ys = this.points().map(p => p.y);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  });

  protected label = (v: VarDef) => (v.unit ? `${v.label} (${v.unit})` : v.label);
  /** Tacche dell'asse: decimali solo se il valore ne ha (20, non 20,0). */
  protected axis = (v: VarDef) => (n: number) => fmt(n, Number.isInteger(n) ? 0 : v.digits);
  protected axisFull = (v: VarDef) => (n: number) => fmtVar(v, n);
  protected strengthOf = strength;
  protected nounOf = (l: Level) => (l === 'comune' ? 'comuni' : l === 'province' ? 'province' : 'regioni');

  protected setLevel(l: Level) {
    this.d.level.set(l);
  }

  protected swap() {
    const x = this.d.x();
    this.d.x.set(this.d.y());
    this.d.y.set(x);
  }

  protected pickPair(x: VarId, y: VarId) {
    this.d.plot(this.d.level(), x, y);
    document.getElementById('esplora')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- matrice ----------
  protected shortLabel(v: VarDef): string {
    const short: Partial<Record<VarId, string>> = {
      density: 'Densità',
      popChange: 'Var. pop.',
      ageMean: 'Età media',
      pct65: 'Over 65',
      pct0_14: 'Under 15',
      foreign: 'Stranieri',
      inc: 'Reddito',
      incChange: 'Var. redd.',
      taxRatio: 'Contrib.',
      quakeRate: 'Sismi',
      tempMean: 'Temp.',
      tempTrend: 'Trend T',
      rain: 'Pioggia',
    };
    return short[v.id] ?? v.label;
  }

  protected matrix = computed(() => {
    const vars = this.vars();
    const units = this.d.units()[this.d.level()];
    const cols = new Map(vars.map(v => [v.id, units.map(u => u.v[v.id] ?? null)]));
    const cache = new Map<string, number | null>();
    const rho = (a: VarId, b: VarId): number | null => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!cache.has(key)) {
        const p = pairs(cols.get(a)!, cols.get(b)!);
        cache.set(key, spearman(p.x, p.y));
      }
      return cache.get(key)!;
    };
    const bg = (r: number | null) =>
      r === null ? 'transparent' : `color-mix(in srgb, ${r >= 0 ? 'var(--accent)' : 'var(--danger)'} ${Math.round(Math.abs(r) * 75)}%, transparent)`;
    return {
      vars,
      rows: vars.map(v => ({
        v,
        cells: vars.map(col => {
          const self = col.id === v.id;
          const r = self ? null : rho(v.id, col.id);
          return { col, self, rho: r, bg: self ? 'var(--surface-2)' : bg(r) };
        }),
      })),
    };
  });

  // ---------- azioni ----------
  /** Apre il dossier dell'unità cliccata e riduce l'analisi per lasciare spazio alla mappa. */
  protected open(id: string) {
    const level = this.d.level();
    if (level === 'comune') {
      const c = this.census.comuni().get(id);
      if (c) this.actions.focusComune(c);
    } else if (level === 'province') this.actions.focusProvince(Number(id));
    else this.actions.focusRegion(Number(id));
    this.ui.analysisMin.set(true);
  }

  protected run(i: Insight) {
    const a = i.action;
    if (!a) return;
    if (a.kind === 'map') {
      this.mapSvc.choropleth.set(a.choro as Choropleth);
      if (a.choro === 'c:alert') this.d.loadAlerts();
      this.ui.analysisMin.set(true);
    } else {
      this.d.plot(a.level, a.x, a.y);
      document.getElementById('esplora')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
