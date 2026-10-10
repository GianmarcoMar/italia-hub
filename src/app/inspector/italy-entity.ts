import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActionsService } from '../core/actions.service';
import { ALERT_COLOR } from '../core/alerts';
import { AlertDay, AlertsService } from '../core/alerts.service';
import { Aggregate } from '../core/census';
import { CensusService } from '../core/census.service';
import { REGIONS } from '../core/italy';
import { MapService } from '../core/map.service';
import { QuakeStore } from '../core/stores';
import { QuakeArea } from './panels/history-panel';
import { TerritoryDossier } from './territory-dossier';

type RegionSort = 'pop' | 'popChange' | 'inc' | 'ageMean' | 'pctForeign' | 'alerts';

const ALL_REGIONS = REGIONS.map(r => r.code);
const ITALY_AREA: QuakeArea = { box: [35.4, 6.6, 47.1, 18.6] };

/** Quadro nazionale: allerte del giorno, sismicità, regioni a confronto, dossier di tutti i comuni. */
@Component({
  selector: 'app-italy-entity',
  imports: [DecimalPipe, TerritoryDossier],
  template: `
    <header class="head">
      <div>
        <span class="tag">Italia</span>
        <span class="id mono">{{ census.italy().comuni | number }} comuni · 107 province · 20 regioni</span>
      </div>
      <h1>Quadro nazionale</h1>
      <div class="actions">
        <button type="button" class="ghost" (click)="mapSvc.fitItaly()">◎ Inquadra</button>
        <button type="button" class="ghost" (click)="mapSvc.choropleth.set('c:alert')">Allerte sulla mappa</button>
        <button type="button" class="ghost" (click)="mapSvc.choropleth.set('c:density')">Densità sulla mappa</button>
      </div>
    </header>

    <section class="kpis">
      <div><b>{{ (census.italy().pop / 1e6) | number: '1.2-2' }}M</b><span>residenti 2025</span></div>
      <div><b>{{ signed(census.italy().popChange) }}</b><span>dal 2020</span></div>
      <div><b>{{ quakes.list().length }}</b><span>terremoti {{ quakes.days() === 1 ? '24 h' : quakes.days() + ' g' }}</span></div>
    </section>

    <section>
      <h3>Allerte Protezione Civile</h3>
      <div class="days">
        @for (d of days; track d.key) {
          <button type="button" class="ghost" [class.on]="day() === d.key" (click)="day.set(d.key)">{{ d.label }}</button>
        }
      </div>
      @if (alerts.loading()) {
        <div class="skeleton" style="height: 60px"></div>
      } @else if (alerts.error()) {
        <p class="muted small">Bollettino non disponibile.</p>
      } @else {
        <div class="levels mono">
          @for (l of [3, 2, 1, 0]; track l) {
            <span><i [style.background]="color(l)"></i>{{ levels()[l] | number }} comuni</span>
          }
        </div>
        <ul class="bulletin">
          @for (line of bulletinLines(); track $index) {
            <li [class.head]="line === line.toUpperCase()">{{ line }}</li>
          }
        </ul>
        <p class="note">{{ alerts.title() }} · Dipartimento della Protezione Civile (CC BY 4.0)</p>
      }
    </section>

    <section>
      <h3>Regioni a confronto</h3>
      <table class="tbl">
        <thead>
          <tr>
            <th>Regione</th>
            @for (c of cols; track c.id) {
              <th>
                <button type="button" [class.on]="sort() === c.id" (click)="sort.set(c.id)">{{ c.label }}</button>
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (r of regionRows(); track r.code) {
            <tr (click)="actions.focusRegion(r.code)" tabindex="0" (keydown.enter)="actions.focusRegion(r.code)">
              <td class="name">{{ r.name }}</td>
              <td class="mono">{{ (r.a.pop / 1e6) | number: '1.2-2' }}M</td>
              <td class="mono" [class.up]="(r.a.popChange ?? 0) > 0" [class.down]="(r.a.popChange ?? 0) < 0">{{ signed(r.a.popChange) }}</td>
              <td class="mono">{{ r.a.inc | number: '1.0-0' }}</td>
              <td class="mono">{{ r.a.ageMean | number: '1.1-1' }}</td>
              <td class="mono">{{ r.a.pctForeign | number: '1.1-1' }}</td>
              <td class="mono">
                @if (r.alerts) {
                  <span class="al" [style.color]="color(r.alertMax)">{{ r.alerts }}</span>
                } @else {
                  —
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="note">Allerte = comuni con allerta gialla o superiore ({{ day() === 'today' ? 'oggi' : 'domani' }}).</p>
    </section>

    @if (census.ready()) {
      <app-territory-dossier
        [comuni]="census.list()"
        label="Italia"
        [capital]="rome()"
        [regions]="allRegions"
        [quakeArea]="italyArea"
        [minMag]="4.5"
        [liveRadius]="60"
      />
    } @else {
      <div class="skeleton" style="height: 300px"></div>
    }
  `,
  styleUrl: './entity.css',
  styles: `
    section {
      display: grid;
      gap: 8px;
    }
    section h3 {
      margin: 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
      color: var(--accent);
    }
    .days {
      display: flex;
      gap: 4px;
    }
    .levels {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      font-size: 0.75rem;
    }
    .levels i {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 5px;
      border-radius: 2px;
      vertical-align: -1px;
    }
    .bulletin {
      list-style: none;
      margin: 0;
      padding: 8px 10px;
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-2);
      font-size: 0.75rem;
      line-height: 1.5;
    }
    .bulletin li.head {
      margin-top: 6px;
      font-family: var(--mono);
      font-size: 0.7rem;
      color: var(--warn);
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.74rem;
    }
    .tbl th,
    .tbl td {
      padding: 4px 4px;
      border-bottom: 1px solid var(--line);
      text-align: right;
      white-space: nowrap;
    }
    .tbl th:first-child,
    .tbl td.name {
      text-align: left;
    }
    .tbl th button {
      padding: 0;
      border: 0;
      background: none;
      color: var(--muted);
      font: inherit;
      font-size: 0.6rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .tbl th button.on {
      color: var(--accent);
    }
    .tbl th {
      font-size: 0.6rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tbl tbody tr {
      cursor: pointer;
    }
    .tbl tbody tr:hover {
      background: var(--hover);
    }
    .up {
      color: var(--ok);
    }
    .down {
      color: var(--danger);
    }
    .al {
      font-weight: 700;
    }
    .note {
      margin: 0;
      font-size: 0.7rem;
      color: var(--faint);
    }
  `,
})
export class ItalyEntity {
  protected census = inject(CensusService);
  protected alerts = inject(AlertsService);
  protected quakes = inject(QuakeStore);
  protected mapSvc = inject(MapService);
  protected actions = inject(ActionsService);
  protected readonly allRegions = ALL_REGIONS;
  protected readonly italyArea = ITALY_AREA;
  protected readonly days = [
    { key: 'today' as AlertDay, label: 'Oggi' },
    { key: 'tomorrow' as AlertDay, label: 'Domani' },
  ];
  protected readonly cols: { id: RegionSort; label: string }[] = [
    { id: 'pop', label: 'Abit.' },
    { id: 'popChange', label: 'Var.' },
    { id: 'inc', label: 'Reddito' },
    { id: 'ageMean', label: 'Età' },
    { id: 'pctForeign', label: 'Stran.' },
    { id: 'alerts', label: 'Allerte' },
  ];
  protected day = signal<AlertDay>('today');
  protected sort = signal<RegionSort>('pop');

  constructor() {
    this.census.load();
    this.alerts.load();
  }

  protected rome = computed(() => this.census.comuni().get('H501') ?? null);

  protected levels = computed(() => this.alerts.countLevels(this.census.list(), this.day()));

  /** Righe del bollettino del giorno scelto (senza la frase introduttiva). */
  protected bulletinLines = computed(() => (this.alerts.text()?.[this.day()] ?? []).slice(1));

  protected regionRows = computed(() => {
    const rows = REGIONS.map(r => {
      const list = this.census.byRegion().get(r.code) ?? [];
      const lv = this.alerts.countLevels(list, this.day());
      return {
        code: r.code,
        name: r.name,
        a: this.census.regionAggregate(r.code),
        alerts: lv[1] + lv[2] + lv[3],
        alertMax: lv[3] ? 3 : lv[2] ? 2 : lv[1] ? 1 : 0,
      };
    });
    const key = this.sort();
    const v = (x: (typeof rows)[number]) => (key === 'alerts' ? x.alerts * 10 + x.alertMax : ((x.a as Aggregate)[key] ?? -Infinity));
    return rows.sort((a, b) => v(b) - v(a));
  });

  protected color(l: number) {
    return ALERT_COLOR[l as 0 | 1 | 2 | 3];
  }

  protected signed(v: number | null) {
    return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
  }
}
