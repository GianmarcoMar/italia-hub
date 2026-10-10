import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { linreg, niceTicks } from '../core/stats';
import { ThemeService } from '../core/theme.service';

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

const PAD = { l: 52, r: 14, t: 12, b: 40 };
const HIT_PX = 12;

/**
 * Grafico a dispersione su canvas (regge migliaia di punti): assi lineari o logaritmici,
 * retta dei minimi quadrati, tooltip al passaggio e clic sul punto.
 */
@Component({
  selector: 'app-scatter',
  template: `
    <div class="wrap" #wrap>
      <canvas
        #cv
        role="img"
        [attr.aria-label]="ariaLabel()"
        (pointermove)="move($event)"
        (pointerleave)="hover.set(null)"
        (click)="click()"
        [style.cursor]="hover() === null ? 'default' : 'pointer'"
      ></canvas>
      @if (tip(); as t) {
        <div class="tip mono" [style.left.px]="t.left" [style.top.px]="t.top">
          <b>{{ t.label }}</b>
          <span>{{ xLabel() }}: {{ t.x }}</span>
          <span>{{ yLabel() }}: {{ t.y }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .wrap {
      position: relative;
    }
    canvas {
      display: block;
      width: 100%;
    }
    .tip {
      position: absolute;
      display: grid;
      padding: 4px 8px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow-md);
      font-size: 0.7rem;
      white-space: nowrap;
      pointer-events: none;
      transform: translate(-50%, calc(-100% - 10px));
    }
    .tip span {
      color: var(--muted);
    }
  `,
})
export class Scatter {
  readonly points = input.required<ScatterPoint[]>();
  readonly xLabel = input('');
  readonly yLabel = input('');
  readonly xLog = input(false);
  readonly yLog = input(false);
  readonly fmtX = input<(v: number) => string>(v => v.toLocaleString('it-IT', { maximumFractionDigits: 1 }));
  readonly fmtY = input<(v: number) => string>(v => v.toLocaleString('it-IT', { maximumFractionDigits: 1 }));
  readonly height = input(340);
  readonly radius = input(2.2);
  readonly ariaLabel = input('Grafico a dispersione');
  readonly pick = output<string>();

  private cv = viewChild<ElementRef<HTMLCanvasElement>>('cv');
  private wrap = viewChild<ElementRef<HTMLElement>>('wrap');
  private theme = inject(ThemeService);
  private width = signal(0);
  protected hover = signal<number | null>(null);

  /** punti nello spazio del grafico (dopo il logaritmo), con i soli valori utilizzabili */
  private view = computed(() => {
    const xl = this.xLog();
    const yl = this.yLog();
    const items = this.points()
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!xl || p.x > 0) && (!yl || p.y > 0))
      .map(p => ({ p, tx: xl ? Math.log10(p.x) : p.x, ty: yl ? Math.log10(p.y) : p.y }));
    if (!items.length) return null;
    const tx = items.map(i => i.tx);
    const ty = items.map(i => i.ty);
    const span = (min: number, max: number) => {
      const pad = (max - min || 1) * 0.04;
      return [min - pad, max + pad] as const;
    };
    return {
      items,
      xd: span(Math.min(...tx), Math.max(...tx)),
      yd: span(Math.min(...ty), Math.max(...ty)),
      line: linreg(tx, ty),
    };
  });

  /** posizioni in pixel dell'ultimo disegno, per trovare il punto sotto il puntatore */
  private px: Float32Array = new Float32Array(0);
  private py: Float32Array = new Float32Array(0);

  protected tip = computed(() => {
    const i = this.hover();
    const v = this.view();
    if (i === null || !v || !v.items[i]) return null;
    const { p } = v.items[i];
    return {
      label: p.label,
      x: this.fmtX()(p.x),
      y: this.fmtY()(p.y),
      left: Math.min(Math.max(this.px[i] ?? 0, 70), this.width() - 70),
      top: Math.max(this.py[i] ?? 0, 56),
    };
  });

  constructor() {
    const ro = new ResizeObserver(entries => this.width.set(Math.floor(entries[0].contentRect.width)));
    effect(() => {
      const w = this.wrap()?.nativeElement;
      if (w) ro.observe(w);
    });
    inject(DestroyRef).onDestroy(() => ro.disconnect());

    effect(() => {
      const canvas = this.cv()?.nativeElement;
      const width = this.width();
      const v = this.view();
      const hover = this.hover();
      this.theme.theme(); // ridisegna al cambio di tema: i colori si leggono dai token
      if (!canvas || !width) return;
      this.draw(canvas, width, v, hover);
    });
  }

  private draw(canvas: HTMLCanvasElement, width: number, v: ReturnType<typeof this.view>, hover: number | null) {
    const H = this.height();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, H);

    const css = getComputedStyle(document.documentElement);
    const color = (n: string) => css.getPropertyValue(n).trim();
    const muted = color('--muted');
    const line = color('--line');
    g.font = '10px ui-monospace, Consolas, monospace';

    if (!v) {
      g.fillStyle = muted;
      g.textAlign = 'center';
      g.fillText('Nessun dato per questa combinazione', width / 2, H / 2);
      this.px = new Float32Array(0);
      this.py = new Float32Array(0);
      return;
    }

    const [x0, x1] = v.xd;
    const [y0, y1] = v.yd;
    const sx = (t: number) => PAD.l + ((t - x0) / (x1 - x0)) * (width - PAD.l - PAD.r);
    const sy = (t: number) => H - PAD.b - ((t - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);

    // griglia e tacche: a decadi per gli assi logaritmici
    const ticks = (log: boolean, a: number, b: number) =>
      log ? Array.from({ length: Math.max(0, Math.floor(b) - Math.ceil(a) + 1) }, (_, i) => Math.ceil(a) + i) : niceTicks(a, b, 5);
    g.lineWidth = 1;
    g.strokeStyle = line;
    g.fillStyle = muted;
    g.textAlign = 'right';
    for (const t of ticks(this.yLog(), y0, y1)) {
      const y = Math.round(sy(t)) + 0.5;
      g.beginPath();
      g.moveTo(PAD.l, y);
      g.lineTo(width - PAD.r, y);
      g.stroke();
      g.fillText(this.fmtY()(this.yLog() ? 10 ** t : t), PAD.l - 6, y + 3);
    }
    g.textAlign = 'center';
    for (const t of ticks(this.xLog(), x0, x1)) {
      const x = Math.round(sx(t)) + 0.5;
      g.beginPath();
      g.moveTo(x, PAD.t);
      g.lineTo(x, H - PAD.b);
      g.stroke();
      g.fillText(this.fmtX()(this.xLog() ? 10 ** t : t), x, H - PAD.b + 14);
    }
    g.fillStyle = muted;
    g.fillText(this.xLabel(), PAD.l + (width - PAD.l - PAD.r) / 2, H - 6);
    g.save();
    g.translate(11, PAD.t + (H - PAD.t - PAD.b) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(this.yLabel(), 0, 0);
    g.restore();

    // punti
    const n = v.items.length;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const r = this.radius();
    g.globalAlpha = n > 1000 ? 0.45 : 0.75;
    v.items.forEach((it, i) => {
      px[i] = sx(it.tx);
      py[i] = sy(it.ty);
      g.fillStyle = it.p.color;
      g.beginPath();
      g.arc(px[i], py[i], r, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
    this.px = px;
    this.py = py;

    // retta dei minimi quadrati
    if (v.line) {
      g.strokeStyle = color('--text');
      g.lineWidth = 1.5;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(sx(x0), sy(v.line.slope * x0 + v.line.intercept));
      g.lineTo(sx(x1), sy(v.line.slope * x1 + v.line.intercept));
      g.stroke();
      g.setLineDash([]);
    }

    // punto sotto il puntatore
    if (hover !== null && v.items[hover]) {
      g.strokeStyle = color('--text');
      g.fillStyle = v.items[hover].p.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px[hover], py[hover], r + 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  protected move(e: PointerEvent) {
    const canvas = this.cv()?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: number | null = null;
    let bestD = HIT_PX * HIT_PX;
    for (let i = 0; i < this.px.length; i++) {
      const d = (this.px[i] - mx) ** 2 + (this.py[i] - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best !== this.hover()) this.hover.set(best);
  }

  protected click() {
    const i = this.hover();
    const v = this.view();
    if (i !== null && v?.items[i]) this.pick.emit(v.items[i].p.id);
  }
}
