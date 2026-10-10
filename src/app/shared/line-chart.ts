import { Component, computed, input, signal } from '@angular/core';

export interface ChartSeries {
  name: string;
  color: string;
  points: { x: number; y: number }[];
}

const W = 640;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

/** Valori "tondi" per le tacche dell'asse y (1, 2, 2.5, 5 × 10^n). */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/**
 * Grafico a linee in SVG puro, senza librerie: più serie, barre opzionali in sottofondo
 * (0–100, es. probabilità di pioggia) e lettura dei valori al passaggio del puntatore.
 */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="wrap">
      <svg
        [attr.viewBox]="'0 0 ' + w + ' ' + height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (pointermove)="move($event)"
        (pointerleave)="hover.set(null)"
      >
        @for (b of geo().bars; track b.x) {
          <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" class="bar" />
        }
        @for (t of geo().yTicks; track t.v) {
          <line [attr.x1]="pad.l" [attr.x2]="w - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" class="grid" />
          <text [attr.x]="pad.l - 6" [attr.y]="t.y + 4" text-anchor="end" class="tick">{{ t.label }}</text>
        }
        @for (t of geo().xTicks; track t.x) {
          <text [attr.x]="t.x" [attr.y]="height() - 6" text-anchor="middle" class="tick">{{ t.label }}</text>
        }
        @for (s of geo().lines; track s.name) {
          <path [attr.d]="s.d" [style.stroke]="s.color" class="line" />
        }
        @if (tip(); as t) {
          <line [attr.x1]="t.px" [attr.x2]="t.px" [attr.y1]="pad.t" [attr.y2]="height() - pad.b" class="guide" />
          @for (v of t.values; track v.name) {
            <circle [attr.cx]="t.px" [attr.cy]="v.py" r="4" [style.fill]="v.color" class="dot" />
          }
        }
      </svg>
      @if (tip(); as t) {
        <div class="tip" [style.left.%]="(t.px / w) * 100" [class.flip]="t.px > w * 0.6">
          <strong>{{ t.label }}</strong>
          @for (v of t.values; track v.name) {
            <span><i [style.background]="v.color"></i>{{ v.name }}: {{ v.text }}</span>
          }
          @if (t.bar !== null) {
            <span class="muted">{{ barsLabel() }}: {{ t.bar }}%</span>
          }
        </div>
      }
    </div>
    @if (series().length > 1) {
      <div class="legend">
        @for (s of series(); track s.name) {
          <span><i [style.background]="s.color"></i>{{ s.name }}</span>
        }
      </div>
    }
  `,
  styles: `
    .wrap {
      position: relative;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      touch-action: pan-y;
    }
    .line {
      fill: none;
      stroke-width: 2.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .grid {
      stroke: var(--line);
    }
    .tick {
      fill: var(--muted);
      font-size: 11px;
    }
    .bar {
      fill: var(--accent);
      opacity: 0.16;
    }
    .guide {
      stroke: var(--muted);
      stroke-dasharray: 3 3;
    }
    .dot {
      stroke: var(--surface);
      stroke-width: 2;
    }
    .tip {
      position: absolute;
      top: 4px;
      transform: translateX(10px);
      display: grid;
      gap: 1px;
      padding: 6px 10px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow-md);
      font-size: 0.8rem;
      white-space: nowrap;
      pointer-events: none;
    }
    .tip.flip {
      transform: translateX(calc(-100% - 10px));
    }
    i {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .legend {
      display: flex;
      gap: 14px;
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 4px;
    }
  `,
})
export class LineChart {
  readonly series = input.required<ChartSeries[]>();
  readonly bars = input<{ x: number; y: number }[]>([]);
  readonly barsLabel = input('');
  readonly height = input(220);
  /** Includere lo zero nell'asse y (sì per grandezze come PIL, no per temperature). */
  readonly zero = input(false);
  readonly xFormat = input<(x: number) => string>(String);
  readonly yFormat = input<(y: number) => string>(y => y.toLocaleString('it-IT', { maximumFractionDigits: 1 }));
  readonly ariaLabel = input('Grafico');

  protected readonly w = W;
  protected readonly pad = PAD;
  protected hover = signal<number | null>(null);

  protected geo = computed(() => {
    const series = this.series().filter(s => s.points.length);
    const H = this.height();
    const xs = [...new Set(series.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => a - b);
    const ys = series.flatMap(s => s.points.map(p => p.y));
    if (!xs.length) return { lines: [], xTicks: [], yTicks: [], bars: [], xs, sx: (x: number) => x, sy: (y: number) => y };

    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    if (this.zero()) {
      y0 = Math.min(0, y0);
      y1 = Math.max(0, y1);
    }
    const span = y1 - y0 || Math.abs(y1) || 1;
    y0 -= span * 0.08;
    y1 += span * 0.08;
    if (this.zero() && Math.min(...ys) >= 0) y0 = 0;

    const sx = (x: number) => PAD.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (y: number) => H - PAD.b - ((y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);

    const lines = series.map(s => ({
      name: s.name,
      color: s.color,
      d: s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' '),
    }));

    const fmt = this.yFormat();
    const yTicks = niceTicks(y0, y1).map(v => ({ v, y: sy(v), label: fmt(v) }));

    const want = 6;
    const every = Math.max(1, Math.ceil(xs.length / want));
    const xf = this.xFormat();
    const xTicks = xs.filter((_, i) => i % every === 0).map(x => ({ x: sx(x), label: xf(x) }));

    const plotH = H - PAD.t - PAD.b;
    const bw = xs.length > 1 ? ((W - PAD.l - PAD.r) / (xs.length - 1)) * 0.6 : 8;
    const bars = this.bars().map(b => {
      const h = (Math.max(0, Math.min(100, b.y)) / 100) * plotH;
      return { x: sx(b.x) - bw / 2, y: H - PAD.b - h, w: bw, h };
    });

    return { lines, xTicks, yTicks, bars, xs, sx, sy };
  });

  /** Valori della x più vicina al puntatore. */
  protected tip = computed(() => {
    const x = this.hover();
    if (x === null) return null;
    const g = this.geo();
    const yf = this.yFormat();
    const values = this.series()
      .map(s => ({ s, p: s.points.find(p => p.x === x) }))
      .filter(v => v.p)
      .map(({ s, p }) => ({ name: s.name, color: s.color, py: g.sy(p!.y), text: yf(p!.y) }));
    const bar = this.bars().find(b => b.x === x);
    return { px: g.sx(x), label: this.xFormat()(x), values, bar: bar ? Math.round(bar.y) : null };
  });

  protected move(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const g = this.geo();
    if (!g.xs.length) return;
    let best = g.xs[0];
    for (const x of g.xs) if (Math.abs(g.sx(x) - px) < Math.abs(g.sx(best) - px)) best = x;
    this.hover.set(best);
  }
}
