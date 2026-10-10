import { Component, computed, input, signal } from '@angular/core';

export interface Bar {
  label: string;
  value: number;
  /** colore della singola barra (altrimenti l'accento) */
  color?: string;
}

const W = 640;
const PAD = { l: 40, r: 8, t: 10, b: 22 };

/** Grafico a barre SVG con valore al passaggio del puntatore. Etichette dell'asse x diradate. */
@Component({
  selector: 'app-bar-chart',
  template: `
    <div class="wrap">
      <svg [attr.viewBox]="'0 0 ' + w + ' ' + height()" role="img" [attr.aria-label]="ariaLabel()" (pointerleave)="hover.set(null)">
        @for (t of geo().ticks; track t.v) {
          <line [attr.x1]="pad.l" [attr.x2]="w - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" class="grid" />
          <text [attr.x]="pad.l - 5" [attr.y]="t.y + 3.5" text-anchor="end" class="tick">{{ t.label }}</text>
        }
        @if (geo().ref; as r) {
          <line [attr.x1]="pad.l" [attr.x2]="w - pad.r" [attr.y1]="r.y" [attr.y2]="r.y" class="ref" />
          <text [attr.x]="w - pad.r" [attr.y]="r.y - 4" text-anchor="end" class="ref-label">{{ refLabel() }}</text>
        }
        @for (b of geo().bars; track b.i) {
          <rect
            [attr.x]="b.x"
            [attr.y]="b.y"
            [attr.width]="b.w"
            [attr.height]="b.h"
            [style.fill]="b.color"
            [class.dim]="hover() !== null && hover() !== b.i"
            (pointerenter)="hover.set(b.i)"
          />
          @if (b.showLabel) {
            <text [attr.x]="b.x + b.w / 2" [attr.y]="height() - 6" text-anchor="middle" class="tick">{{ b.label }}</text>
          }
        }
      </svg>
      @if (tip(); as t) {
        <div class="tip mono" [style.left.%]="t.left">
          <b>{{ t.label }}</b> {{ t.text }}
        </div>
      }
    </div>
  `,
  styles: `
    .wrap {
      position: relative;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    rect {
      transition: opacity 0.1s;
    }
    rect.dim {
      opacity: 0.4;
    }
    .grid {
      stroke: var(--line);
    }
    .ref {
      stroke: var(--warn);
      stroke-dasharray: 4 3;
    }
    .ref-label {
      fill: var(--warn);
      font-size: 10px;
      font-family: var(--mono);
    }
    .tick {
      fill: var(--muted);
      font-size: 10px;
      font-family: var(--mono);
    }
    .tip {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      padding: 2px 8px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: 0.72rem;
      white-space: nowrap;
      pointer-events: none;
    }
  `,
})
export class BarChart {
  readonly bars = input.required<Bar[]>();
  readonly height = input(150);
  readonly format = input<(v: number) => string>(v => v.toLocaleString('it-IT', { maximumFractionDigits: 1 }));
  /** linea di riferimento orizzontale (es. media) */
  readonly ref = input<number | null>(null);
  readonly refLabel = input('');
  readonly ariaLabel = input('Grafico a barre');
  /** quante etichette dell'asse x mostrare al massimo */
  readonly maxLabels = input(8);

  protected readonly w = W;
  protected readonly pad = PAD;
  protected hover = signal<number | null>(null);

  protected geo = computed(() => {
    const bars = this.bars();
    const H = this.height();
    const values = bars.map(b => b.value);
    const ref = this.ref();
    const max = Math.max(0, ...values, ref ?? 0) || 1;
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const plotW = W - PAD.l - PAD.r;
    const step = plotW / Math.max(1, bars.length);
    const bw = Math.max(1, step * 0.78);
    const sy = (v: number) => PAD.t + ((max - v) / span) * (H - PAD.t - PAD.b);
    const every = Math.max(1, Math.ceil(bars.length / this.maxLabels()));
    const fmt = this.format();
    return {
      bars: bars.map((b, i) => {
        const y0 = sy(Math.max(0, b.value));
        const y1 = sy(Math.min(0, b.value));
        return {
          i,
          x: PAD.l + i * step + (step - bw) / 2,
          y: y0,
          w: bw,
          h: Math.max(b.value ? 1 : 0, y1 - y0),
          color: b.color ?? 'var(--accent)',
          label: b.label,
          showLabel: i % every === 0,
        };
      }),
      ticks: [min, (min + max) / 2, max].filter((v, i, a) => a.indexOf(v) === i).map(v => ({ v, y: sy(v), label: compact(v, fmt) })),
      ref: ref !== null ? { y: sy(ref) } : null,
    };
  });

  protected tip = computed(() => {
    const i = this.hover();
    if (i === null) return null;
    const b = this.bars()[i];
    const g = this.geo().bars[i];
    return { label: b.label, text: this.format()(b.value), left: ((g.x + g.w / 2) / W) * 100 };
  });
}

/** Etichette brevi per l'asse: 12.500 → 12,5k. */
function compact(v: number, fmt: (v: number) => string): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })}M`;
  if (a >= 1e4) return `${(v / 1e3).toLocaleString('it-IT', { maximumFractionDigits: 0 })}k`;
  return fmt(v);
}
