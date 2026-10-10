import { Component, computed, input, signal } from '@angular/core';

const LABELS = Array.from({ length: 21 }, (_, i) => (i === 20 ? '100+' : `${i * 5}–${i * 5 + 4}`));

/**
 * Piramide delle età (fasce di 5 anni): maschi a sinistra, femmine a destra, in % della popolazione.
 * Con `compare` (es. l'Italia) si sovrappone il profilo di riferimento.
 */
@Component({
  selector: 'app-pyramid',
  template: `
    <svg viewBox="0 0 320 236" role="img" aria-label="Piramide delle età" (pointerleave)="hover.set(null)">
      <text x="80" y="10" text-anchor="middle" class="h">Maschi</text>
      <text x="240" y="10" text-anchor="middle" class="h">Femmine</text>
      @for (r of rows(); track r.i) {
        <g (pointerenter)="hover.set(r.i)">
          <rect [attr.x]="160 - 18 - r.m" [attr.y]="r.y" [attr.width]="r.m" height="9" class="m" />
          <rect x="178" [attr.y]="r.y" [attr.width]="r.f" height="9" class="f" />
          @if (r.cm !== null) {
            <line [attr.x1]="160 - 18 - r.cm" [attr.x2]="160 - 18 - r.cm" [attr.y1]="r.y" [attr.y2]="r.y + 9" class="cmp" />
            <line [attr.x1]="178 + r.cf!" [attr.x2]="178 + r.cf!" [attr.y1]="r.y" [attr.y2]="r.y + 9" class="cmp" />
          }
          @if (r.i % 2 === 0) {
            <text x="160" [attr.y]="r.y + 8" text-anchor="middle" class="age">{{ r.label }}</text>
          }
        </g>
      }
    </svg>
    <p class="foot mono">
      @if (hover() !== null) {
        {{ labels[hover()!] }} anni · M {{ pct(m()[hover()!]) }} · F {{ pct(f()[hover()!]) }}
      } @else {
        quota per fascia d'età
        @if (compareLabel()) {
          · <span class="cmp-key">|</span> {{ compareLabel() }}
        }
      }
    </p>
  `,
  styles: `
    svg {
      display: block;
      width: 100%;
      max-width: 420px;
      margin: 0 auto;
    }
    .m {
      fill: #38bdf8;
    }
    .f {
      fill: #f472b6;
    }
    .cmp {
      stroke: var(--text);
      stroke-width: 1.5;
    }
    .age {
      fill: var(--muted);
      font-size: 7.5px;
      font-family: var(--mono);
    }
    .h {
      fill: var(--muted);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    g:hover rect {
      opacity: 0.8;
    }
    .foot {
      margin: 2px 0 0;
      text-align: center;
      font-size: 0.7rem;
      color: var(--muted);
    }
    .cmp-key {
      color: var(--text);
      font-weight: 700;
    }
  `,
})
export class Pyramid {
  readonly m = input.required<number[]>();
  readonly f = input.required<number[]>();
  readonly compareM = input<number[] | null>(null);
  readonly compareF = input<number[] | null>(null);
  readonly compareLabel = input('');

  protected readonly labels = LABELS;
  protected hover = signal<number | null>(null);

  private total = computed(() => sum(this.m()) + sum(this.f()) || 1);

  protected rows = computed(() => {
    const t = this.total();
    const cm = this.compareM();
    const cf = this.compareF();
    const ct = cm && cf ? sum(cm) + sum(cf) || 1 : 1;
    const shares = [...this.m(), ...this.f(), ...(cm && cf ? [...cm.map(v => (v / ct) * t), ...cf.map(v => (v / ct) * t)] : [])];
    const max = Math.max(...shares.map(v => v / t), 0.0001);
    const scale = (v: number) => (v / t / max) * 140; // 140px = metà larghezza utile
    return LABELS.map((label, i) => ({
      i,
      label,
      y: 222 - i * 10.4,
      m: scale(this.m()[i] ?? 0),
      f: scale(this.f()[i] ?? 0),
      cm: cm ? scale(((cm[i] ?? 0) / ct) * t) : null,
      cf: cf ? scale(((cf[i] ?? 0) / ct) * t) : null,
    }));
  });

  protected pct(v: number | undefined) {
    return `${(((v ?? 0) / this.total()) * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
  }
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
