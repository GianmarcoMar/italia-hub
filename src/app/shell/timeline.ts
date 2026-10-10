import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { binEvents } from '../core/analysis';
import { SelectionService } from '../core/selection.service';
import { QuakeStore } from '../core/stores';

const W = 1000;
const H = 48;
/** Durata del replay dall'inizio alla fine del periodo. */
const PLAY_MS = 14_000;

const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const hourFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

/**
 * Timeline degli eventi sismici: istogramma del periodo, trascinando si sceglie una finestra
 * (filtra mappa, elenchi e analisi), play fa scorrere la finestra nel tempo.
 */
@Component({
  selector: 'app-timeline',
  imports: [DatePipe],
  template: `
    <div class="head">
      <span class="label">Timeline eventi</span>
      <button type="button" class="ctl" (click)="togglePlay()" [attr.aria-label]="playing() ? 'Pausa' : 'Riproduci'">
        {{ playing() ? '❚❚' : '▶' }}
      </button>
      @if (store.window(); as w) {
        <span class="mono win">
          {{ w[0] | date: 'd MMM HH:mm' }} → {{ w[1] | date: 'd MMM HH:mm' }} ·
          <b>{{ store.visible().length }}</b> / {{ store.list().length }} eventi
        </span>
        <button type="button" class="ctl" (click)="clear()">Azzera</button>
      } @else {
        <span class="muted small hint">Trascina sulla barra per isolare un intervallo</span>
      }
      <span class="mono max">max {{ maxCount() }}/barra</span>
    </div>

    <div class="track">
      <svg
        [attr.viewBox]="'0 0 ' + w + ' ' + h"
        preserveAspectRatio="none"
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        role="slider"
        aria-label="Finestra temporale"
        [attr.aria-valuetext]="store.window() ? 'intervallo selezionato' : 'tutto il periodo'"
      >
        @for (b of bars(); track b.x) {
          <rect [attr.x]="b.x" [attr.y]="h - b.h" [attr.width]="b.w" [attr.height]="b.h" [class.in]="b.in" [class.strong]="b.strong">
            <title>{{ b.title }}</title>
          </rect>
        }
        @if (winRect(); as r) {
          <rect class="window" [attr.x]="r.x" y="0" [attr.width]="r.w" [attr.height]="h" />
        }
        @for (m of marks(); track m.cls) {
          <line [attr.x1]="m.x" [attr.x2]="m.x" y1="0" [attr.y2]="h" [class]="m.cls" />
        }
      </svg>
      <div class="ticks mono">
        @for (t of ticks(); track t.x) {
          <span [style.left.%]="t.x / 10">{{ t.label }}</span>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 4px;
      padding: 6px 12px 4px;
      min-width: 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .head .label {
      margin: 0;
    }
    .ctl {
      font: inherit;
      font-family: var(--mono);
      font-size: 0.7rem;
      padding: 2px 8px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }
    .ctl:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .win {
      font-size: 0.72rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .win b {
      color: var(--accent);
    }
    .hint {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .max {
      margin-left: auto;
      font-size: 0.68rem;
      color: var(--faint);
      white-space: nowrap;
    }
    .track {
      position: relative;
      min-height: 0;
    }
    svg {
      display: block;
      width: 100%;
      height: 44px;
      cursor: crosshair;
      touch-action: none;
      background:
        repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), var(--line) calc(10% - 1px) 10%),
        var(--surface-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }
    rect {
      fill: var(--accent);
      opacity: 0.35;
    }
    rect.in {
      opacity: 0.85;
    }
    rect.strong {
      fill: var(--warn);
    }
    rect.window {
      fill: var(--accent);
      opacity: 0.1;
      stroke: var(--accent);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    line {
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    line.sel {
      stroke: var(--text);
    }
    line.hot {
      stroke: var(--warn);
      stroke-dasharray: 3 2;
    }
    .ticks {
      position: relative;
      height: 14px;
      font-size: 0.64rem;
      color: var(--muted);
    }
    .ticks span {
      position: absolute;
      transform: translateX(-50%);
      white-space: nowrap;
    }
  `,
})
export class Timeline {
  protected store = inject(QuakeStore);
  private sel = inject(SelectionService);
  protected readonly w = W;
  protected readonly h = H;
  protected playing = signal(false);

  private range = computed(() => this.store.range());
  private x = (t: number) => {
    const [a, b] = this.range();
    return ((t - a) / (b - a)) * W;
  };
  private t = (x: number) => {
    const [a, b] = this.range();
    return a + (Math.max(0, Math.min(W, x)) / W) * (b - a);
  };

  private bins = computed(() => {
    const [a, b] = this.range();
    return binEvents(this.store.list(), a, b);
  });

  protected maxCount = computed(() => Math.max(0, ...this.bins().map(b => b.count)));

  protected bars = computed(() => {
    const max = Math.max(1, this.maxCount());
    const win = this.store.window();
    return this.bins().map(b => {
      const x = Math.max(0, this.x(b.from));
      const w = Math.max(0.5, this.x(b.to) - x - 1.5);
      const inside = !win || (b.to > Math.min(...win) && b.from < Math.max(...win));
      return {
        x,
        w,
        h: b.count ? Math.max(2, (b.count / max) * (H - 4)) : 0,
        in: inside,
        strong: b.maxMag >= 4,
        title: `${dateFmt.format(b.from)} ${hourFmt.format(b.from)}: ${b.count} eventi${b.count ? `, max M${b.maxMag.toFixed(1)}` : ''}`,
      };
    });
  });

  protected winRect = computed(() => {
    const w = this.store.window();
    if (!w) return null;
    const a = this.x(Math.min(...w));
    const b = this.x(Math.max(...w));
    return { x: a, w: Math.max(1, b - a) };
  });

  /** Linee dell'evento selezionato e di quello sotto il puntatore. */
  protected marks = computed(() => {
    const out: { x: number; cls: string }[] = [];
    const s = this.sel.selected();
    const byId = this.store.byId();
    if (s.kind === 'quake' && byId.get(s.id)) out.push({ x: this.x(byId.get(s.id)!.time), cls: 'sel' });
    const h = this.sel.hoveredQuake();
    if (h && byId.get(h)) out.push({ x: this.x(byId.get(h)!.time), cls: 'hot' });
    return out;
  });

  protected ticks = computed(() => {
    const [a, b] = this.range();
    const days = (b - a) / 86_400_000;
    const step = days <= 1.5 ? 3 * 3_600_000 : days <= 10 ? 86_400_000 : 5 * 86_400_000;
    const fmt = (t: number) => (days <= 1.5 ? hourFmt.format(t) : days <= 10 ? dayFmt.format(t) : dateFmt.format(t));
    const out: { x: number; label: string }[] = [];
    // allineate a mezzanotte/ora locale piena
    const first = new Date(a);
    if (step >= 86_400_000) first.setHours(24, 0, 0, 0);
    else first.setHours(first.getHours() + 1, 0, 0, 0);
    for (let t = first.getTime(); t < b; t += step) {
      const x = this.x(t);
      if (x > 30 && x < W - 30) out.push({ x, label: fmt(t) });
    }
    return out;
  });

  // ---------- brush ----------
  private dragFrom: number | null = null;
  private dragX0 = 0;

  private toViewX(e: PointerEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  }

  protected down(e: PointerEvent) {
    this.stop();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.dragX0 = e.clientX;
    this.dragFrom = this.t(this.toViewX(e));
  }

  protected move(e: PointerEvent) {
    if (this.dragFrom === null) return;
    if (Math.abs(e.clientX - this.dragX0) < 4) return;
    const t = this.t(this.toViewX(e));
    this.store.window.set([Math.min(this.dragFrom, t), Math.max(this.dragFrom, t)]);
  }

  protected up(e: PointerEvent) {
    // un clic senza trascinare azzera la finestra
    if (this.dragFrom !== null && Math.abs(e.clientX - this.dragX0) < 4) this.store.window.set(null);
    this.dragFrom = null;
  }

  protected clear() {
    this.stop();
    this.store.window.set(null);
  }

  // ---------- replay ----------
  private raf = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected togglePlay() {
    if (this.playing()) return this.stop();
    const [a, b] = this.range();
    const span = b - a;
    const win = this.store.window();
    const width = win ? Math.abs(win[1] - win[0]) : span / 6;
    // se la finestra è già alla fine, si riparte dall'inizio
    let start = win && Math.max(...win) < b - span * 0.01 ? Math.min(...win) : a;
    this.store.window.set([start, start + width]);
    this.playing.set(true);
    let last = performance.now();
    const speed = span / PLAY_MS;
    const tick = (now: number) => {
      start += (now - last) * speed;
      last = now;
      if (start + width >= b) {
        this.store.window.set([b - width, b]);
        return this.stop();
      }
      this.store.window.set([start, start + width]);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.playing.set(false);
  }
}
