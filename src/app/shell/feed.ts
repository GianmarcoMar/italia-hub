import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActionsService } from '../core/actions.service';
import { depthColor } from '../core/format';
import { Quake } from '../core/parsers';
import { SelectionService } from '../core/selection.service';
import { CapitalsWeatherStore, QuakeStore } from '../core/stores';
import { weatherIcon } from '../core/weather';

const MAX = 40;

type Item =
  | { kind: 'quake'; key: string; time: number; q: Quake }
  | { kind: 'alert'; key: string; time: number; level: 'warn' | 'alarm'; label: string; city: string; code: number; region: number };

/**
 * Flusso cronologico: terremoti (aggiornati ogni 2 minuti) e allerte meteo dei capoluoghi.
 * Gli eventi arrivati dopo il primo caricamento vengono evidenziati come nuovi.
 */
@Component({
  selector: 'app-feed',
  imports: [DatePipe, DecimalPipe],
  template: `
    <h3>
      Feed live
      @if (freshCount()) {
        <span class="new">{{ freshCount() }} nuovi</span>
      }
    </h3>
    <ul>
      @for (it of items(); track it.key) {
        @switch (it.kind) {
          @case ('quake') {
            <li
              [class.fresh]="fresh().has(it.key)"
              [class.hot]="sel.hoveredQuake() === it.q.id"
              [class.sel]="sel.isQuake(it.q.id)"
              (mouseenter)="sel.hoveredQuake.set(it.q.id)"
              (mouseleave)="sel.hoveredQuake.set(null)"
            >
              <button type="button" (click)="actions.focusQuake(it.q)">
                <span class="t mono">{{ it.time | date: 'dd/MM HH:mm' }}</span>
                <span class="m mono" [style.color]="color(it.q.depthKm)">M{{ it.q.mag | number: '1.1-1' }}</span>
                <span class="txt">{{ it.q.place }}</span>
              </button>
            </li>
          }
          @case ('alert') {
            <li [class]="'alert ' + it.level">
              <button type="button" (click)="actions.goCapital(it.region)">
                <span class="t mono">{{ it.time | date: 'HH:mm' }}</span>
                <span class="m">{{ icon(it.code) }}</span>
                <span class="txt"><b>{{ it.city }}</b> · {{ it.label }}</span>
              </button>
            </li>
          }
        }
      } @empty {
        <li class="muted small empty">In attesa di eventi…</li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .new {
      padding: 0 6px;
      border-radius: 2px;
      background: var(--accent);
      color: var(--accent-ink);
      font-family: var(--mono);
      letter-spacing: 0;
    }
    ul {
      list-style: none;
      margin: 0 -6px;
      padding: 0;
      overflow-y: auto;
      min-height: 0;
    }
    li {
      border-left: 2px solid transparent;
    }
    li button {
      width: 100%;
      display: grid;
      grid-template-columns: 76px 44px 1fr;
      align-items: baseline;
      gap: 6px;
      padding: 4px 6px;
      border: 0;
      background: none;
      color: var(--text);
      font: inherit;
      font-size: 0.76rem;
      text-align: left;
      cursor: pointer;
    }
    li:hover,
    li.hot {
      background: var(--hover);
    }
    li.sel {
      border-left-color: var(--accent);
      background: var(--accent-soft);
    }
    li.fresh {
      border-left-color: var(--warn);
      animation: flash 2s ease-out;
    }
    li.alert.warn {
      border-left-color: var(--warn);
    }
    li.alert.alarm {
      border-left-color: var(--danger);
      background: var(--danger-soft);
    }
    .t {
      color: var(--muted);
      font-size: 0.72rem;
    }
    .m {
      font-weight: 700;
    }
    .txt {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      padding: 8px 6px;
    }
    @keyframes flash {
      from {
        background: var(--warn-soft);
      }
    }
  `,
})
export class Feed {
  private quakes = inject(QuakeStore);
  private capitals = inject(CapitalsWeatherStore);
  protected actions = inject(ActionsService);
  protected sel = inject(SelectionService);
  protected readonly color = depthColor;
  protected readonly icon = weatherIcon;

  /** Chiavi già viste: tutto ciò che c'era al primo caricamento non è "nuovo". */
  private seen: Set<string> | null = null;
  protected fresh = signal(new Set<string>());
  protected freshCount = computed(() => this.fresh().size);

  protected items = computed<Item[]>(() => {
    const qs: Item[] = [...this.quakes.list()]
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX)
      .map(q => ({ kind: 'quake', key: `q:${q.id}`, time: q.time, q }));
    const at = this.capitals.updatedAt() ?? Date.now();
    const alerts: Item[] = this.capitals.alerts().map(a => ({
      kind: 'alert',
      key: `a:${a.region.code}:${a.alert!.key}`,
      time: at,
      level: a.alert!.level,
      label: a.alert!.label,
      city: a.region.capital.name,
      code: a.now!.code,
      region: a.region.code,
    }));
    return [...alerts, ...qs].sort((a, b) => b.time - a.time);
  });

  constructor() {
    // filtri cambiati (loading) = nuova base, non "nuovi eventi"; il polling è "reloading" e non azzera
    effect(() => {
      if (this.quakes.quakes.status() === 'loading') {
        this.seen = null;
        this.fresh.set(new Set());
      }
    });

    effect(() => {
      if (this.quakes.quakes.status() === 'loading') return;
      const keys = this.items().map(i => i.key);
      if (!keys.length) return;
      untracked(() => {
        if (!this.seen) {
          this.seen = new Set(keys);
          return;
        }
        const added = keys.filter(k => !this.seen!.has(k));
        added.forEach(k => this.seen!.add(k));
        if (added.length) this.fresh.update(s => new Set([...s, ...added]));
      });
    });
  }
}
