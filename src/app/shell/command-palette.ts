import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { PaletteService } from '../core/palette.service';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ActionsService } from '../core/actions.service';
import { ApisService } from '../core/apis.service';
import { CensusService } from '../core/census.service';
import { GeoService } from '../core/geo.service';
import { REGIONS } from '../core/italy';
import { MapService } from '../core/map.service';
import { QuakeStore } from '../core/stores';
import { ThemeService } from '../core/theme.service';
import { UiService } from '../core/ui.service';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Minuscole e senza accenti, per confronti tolleranti ("citta" trova "Città"). */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const MAX_PER_GROUP = 6;

/**
 * Palette dei comandi (Ctrl+K o /): cerca comandi, regioni, province, eventi sismici in elenco
 * e luoghi (geocoding Open-Meteo). Si usa solo da tastiera, se si vuole.
 */
@Component({
  selector: 'app-command-palette',
  host: {
    '(document:keydown)': 'onGlobalKey($event)',
  },
  template: `
    @if (open()) {
      <div class="backdrop" (click)="close()"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Comandi e ricerca">
        <div class="input">
          <span class="prompt mono">›</span>
          <input
            #input
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="Cerca un luogo, una regione, un evento o un comando…"
            [value]="query()"
            (input)="setQuery($any($event.target).value)"
            (keydown)="onKey($event)"
            role="combobox"
            aria-controls="cmd-list"
            [attr.aria-activedescendant]="items()[active()] ? 'cmd-' + active() : null"
          />
          @if (places.isLoading()) {
            <span class="spin" aria-label="ricerca"></span>
          }
          <kbd>Esc</kbd>
        </div>
        <ul id="cmd-list" role="listbox">
          @for (it of items(); track it.id; let i = $index) {
            @if (i === 0 || items()[i - 1].group !== it.group) {
              <li class="group label" role="presentation">{{ it.group }}</li>
            }
            <li
              [id]="'cmd-' + i"
              role="option"
              [attr.aria-selected]="i === active()"
              [class.active]="i === active()"
              (mousemove)="active.set(i)"
              (click)="run(it)"
            >
              <span>{{ it.label }}</span>
              @if (it.hint) {
                <span class="hint mono">{{ it.hint }}</span>
              }
            </li>
          } @empty {
            <li class="empty muted">Nessun risultato.</li>
          }
        </ul>
        <div class="foot mono">
          <span><kbd>↑</kbd><kbd>↓</kbd> scegli</span>
          <span><kbd>↵</kbd> esegui</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> apri/chiudi</span>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgb(0 0 0 / 0.45);
      backdrop-filter: blur(2px);
    }
    .dialog {
      position: fixed;
      z-index: 2001;
      top: 12vh;
      left: 50%;
      transform: translateX(-50%);
      width: min(640px, calc(100vw - 32px));
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      box-shadow: var(--shadow-md);
      overflow: hidden;
    }
    .input {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
    }
    .prompt {
      color: var(--accent);
      font-size: 1.1rem;
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: none;
      padding: 4px 0;
      font-size: 1rem;
    }
    input:focus-visible {
      outline: none;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 6px;
      overflow-y: auto;
    }
    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border-radius: var(--radius);
      font-size: 0.88rem;
      cursor: pointer;
    }
    li.active {
      background: var(--accent-soft);
      color: var(--accent);
    }
    li.group {
      padding: 10px 10px 4px;
      margin: 0;
      cursor: default;
    }
    .hint {
      margin-left: auto;
      font-size: 0.72rem;
      color: var(--muted);
      white-space: nowrap;
    }
    .empty {
      cursor: default;
    }
    .foot {
      display: flex;
      gap: 16px;
      padding: 8px 14px;
      border-top: 1px solid var(--line);
      font-size: 0.68rem;
      color: var(--muted);
    }
    .foot kbd {
      margin-right: 2px;
    }
    .spin {
      width: 12px;
      height: 12px;
      border: 2px solid var(--line-strong);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class CommandPalette {
  private api = inject(ApisService);
  private ui = inject(UiService);
  private geo = inject(GeoService);
  private mapSvc = inject(MapService);
  private quakes = inject(QuakeStore);
  private theme = inject(ThemeService);
  private actions = inject(ActionsService);
  private census = inject(CensusService);
  private input = viewChild<ElementRef<HTMLInputElement>>('input');

  private palette = inject(PaletteService);
  protected open = this.palette.open;
  protected query = signal('');
  protected active = signal(0);

  /** Luoghi dal geocoding, con un piccolo ritardo mentre si digita. */
  protected places = rxResource({
    params: () => (this.open() && this.query().trim().length >= 2 ? this.query().trim() : undefined),
    stream: ({ params: q }) =>
      timer(250).pipe(
        switchMap(() => this.api.geocode(q)),
        catchError(() => of([])),
      ),
  });

  private commands = computed<Item[]>(() => {
    const q = this.quakes;
    return [
      { id: 'analysis', group: 'Comandi', label: 'Analisi incrociata: conclusioni, grafici e correlazioni', hint: 'dashboard', run: () => this.ui.openAnalysis() },
      { id: 'italy', group: 'Comandi', label: 'Quadro nazionale (Italia)', hint: 'entità', run: () => this.actions.focusItaly() },
      { id: 'alerts', group: 'Comandi', label: 'Mostra le zone d\'allerta della Protezione Civile', hint: 'layer', run: () => this.mapSvc.showAlerts.set(true) },
      { id: 'c-alert', group: 'Comandi', label: 'Colora i comuni per allerta di oggi', hint: 'analisi', run: () => this.mapSvc.choropleth.set('c:alert') },
      { id: 'c-density', group: 'Comandi', label: 'Colora i comuni per densità', hint: 'analisi', run: () => this.mapSvc.choropleth.set('c:density') },
      { id: 'c-income', group: 'Comandi', label: 'Colora i comuni per reddito medio', hint: 'analisi', run: () => this.mapSvc.choropleth.set('c:income') },
      { id: 'c-pop', group: 'Comandi', label: 'Colora i comuni per variazione della popolazione', hint: 'analisi', run: () => this.mapSvc.choropleth.set('c:popChange') },
      { id: 'c-age', group: 'Comandi', label: 'Colora i comuni per età media', hint: 'analisi', run: () => this.mapSvc.choropleth.set('c:age') },
      { id: 'p-aqi', group: 'Comandi', label: 'Qualità dell\'aria ora per provincia', hint: 'tempo reale', run: () => this.mapSvc.choropleth.set('p:aqi') },
      { id: 'd1', group: 'Comandi', label: 'Sismica: ultime 24 ore', hint: 'periodo', run: () => q.days.set(1) },
      { id: 'd7', group: 'Comandi', label: 'Sismica: ultimi 7 giorni', hint: 'periodo', run: () => q.days.set(7) },
      { id: 'd30', group: 'Comandi', label: 'Sismica: ultimi 30 giorni', hint: 'periodo', run: () => q.days.set(30) },
      { id: 'ingv', group: 'Comandi', label: 'Sismica: fonte INGV (Italia)', hint: 'fonte', run: () => q.source.set('ingv') },
      { id: 'usgs', group: 'Comandi', label: 'Sismica: fonte USGS (mondo)', hint: 'fonte', run: () => q.source.set('usgs') },
      { id: 'chq', group: 'Comandi', label: 'Colora regioni per terremoti', hint: 'analisi', run: () => this.mapSvc.choropleth.set('quakes') },
      { id: 'cht', group: 'Comandi', label: 'Colora regioni per temperatura', hint: 'analisi', run: () => this.mapSvc.choropleth.set('temp') },
      { id: 'chn', group: 'Comandi', label: 'Togli la colorazione delle regioni', hint: 'analisi', run: () => this.mapSvc.choropleth.set('none') },
      { id: 'win', group: 'Comandi', label: 'Azzera la finestra della timeline', hint: 'timeline', run: () => q.window.set(null) },
      { id: 'lw', group: 'Comandi', label: 'Mostra/nascondi meteo capoluoghi', hint: 'layer', run: () => this.mapSvc.showWeather.update(v => !v) },
      { id: 'lq', group: 'Comandi', label: 'Mostra/nascondi eventi sismici', hint: 'layer', run: () => this.mapSvc.showQuakes.update(v => !v) },
      { id: 'theme', group: 'Comandi', label: 'Cambia tema chiaro/scuro', hint: 'vista', run: () => this.theme.toggle() },
      { id: 'sources', group: 'Comandi', label: 'Fonti e licenze dei dati', hint: 'info', run: () => this.ui.sourcesOpen.set(true) },
      { id: 'rail', group: 'Comandi', label: 'Mostra/nascondi il pannello dei layer', hint: 'vista', run: () => this.ui.railOpen.update(v => !v) },
      { id: 'link', group: 'Comandi', label: 'Copia il link di questa vista', hint: 'condividi', run: () => navigator.clipboard?.writeText(location.href) },
    ];
  });

  protected items = computed<Item[]>(() => {
    const raw = this.query().trim();
    const q = norm(raw);
    const match = (s: string) => !q || norm(s).includes(q);

    const cmds = this.commands().filter(c => match(c.label) || match(c.hint ?? ''));
    if (!q) return cmds.slice(0, 10);

    const regions = REGIONS.filter(r => match(r.name) || match(r.en))
      .slice(0, MAX_PER_GROUP)
      .map<Item>(r => ({ id: `r${r.code}`, group: 'Regioni', label: r.name, hint: `capoluogo ${r.capital.name}`, run: () => this.actions.focusRegion(r.code) }));

    const provinces = (this.geo.provinces.hasValue() ? this.geo.provinces.value().features : [])
      .filter(p => match(p.properties.prov_name) || norm(p.properties.prov_acr) === q)
      .slice(0, MAX_PER_GROUP)
      .map<Item>(p => ({
        id: `p${p.properties.prov_istat_code_num}`,
        group: 'Province',
        label: p.properties.prov_name,
        hint: p.properties.prov_acr,
        run: () => this.actions.focusProvince(p.properties.prov_istat_code_num),
      }));

    const comuni = this.census.search(raw, MAX_PER_GROUP).map<Item>(c => ({
      id: `c${c.k}`,
      group: 'Comuni',
      label: c.name,
      hint: `${c.provAcr} · ${(c.pop ?? 0).toLocaleString('it-IT')} ab`,
      run: () => this.actions.focusComune(c),
    }));

    const events = this.quakes
      .list()
      .filter(e => match(e.place))
      .sort((a, b) => b.mag - a.mag)
      .slice(0, MAX_PER_GROUP)
      .map<Item>(e => ({ id: `q${e.id}`, group: 'Eventi sismici', label: e.place, hint: `M${e.mag.toFixed(1)}`, run: () => this.actions.focusQuake(e) }));

    const places = (this.places.hasValue() ? (this.places.value() ?? []) : [])
      .slice(0, MAX_PER_GROUP)
      .map<Item>((p, i) => ({ id: `l${i}${p.lat}`, group: 'Luoghi', label: p.name, hint: p.detail, run: () => this.actions.goPlace(p) }));

    // i comuni (dati ISTAT locali) prima dei luoghi del geocoding, che arrivano dalla rete
    return [...comuni, ...regions, ...provinces, ...places, ...events, ...cmds.slice(0, MAX_PER_GROUP)];
  });

  constructor() {
    // all'apertura (da tastiera o dal pulsante in alto): campo vuoto e cursore nel campo
    effect(() => {
      if (!this.open()) return;
      this.census.load(); // per cercare tra i comuni
      untracked(() => {
        this.query.set('');
        this.active.set(0);
      });
      setTimeout(() => this.input()?.nativeElement.focus());
    });
  }

  toggle() {
    this.palette.toggle();
  }

  protected close() {
    this.open.set(false);
  }

  protected setQuery(v: string) {
    this.query.set(v);
    this.active.set(0);
  }

  protected run(it: Item) {
    this.close();
    it.run();
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.items().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.update(i => (n ? (i + 1) % n : 0));
      this.scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.update(i => (n ? (i - 1 + n) % n : 0));
      this.scrollActive();
    } else if (e.key === 'Enter') {
      const it = this.items()[this.active()];
      if (it) this.run(it);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  private scrollActive() {
    setTimeout(() => document.getElementById(`cmd-${this.active()}`)?.scrollIntoView({ block: 'nearest' }));
  }

  /** Ctrl/Cmd+K ovunque; "/" quando non si sta scrivendo in un campo. */
  protected onGlobalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.toggle();
      return;
    }
    const t = e.target as HTMLElement;
    const typing = t.closest('input, textarea, select, [contenteditable]');
    if (e.key === '/' && !typing && !this.open()) {
      e.preventDefault();
      this.toggle();
    }
  }
}
