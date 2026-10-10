import { Component, computed, input, output } from '@angular/core';

export interface GraphNode {
  id: string;
  label: string;
  /** Riga secondaria (es. "M 3.1", "12 km"). */
  sub?: string;
  kind: 'quake' | 'region' | 'province' | 'place' | 'city' | 'data';
}

// ellisse 130×88 e etichette ≤ 16 caratteri: stanno nel riquadro anche ai lati
const W = 480;
const H = 236;
const RX = 130;
const RY = 88;
const MAX_LABEL = 16;
const CX = W / 2;
const CY = H / 2;

const COLORS: Record<GraphNode['kind'], string> = {
  quake: '#f5a524',
  region: '#2dd4bf',
  province: '#5eead4',
  place: '#a78bfa',
  city: '#38bdf8',
  data: '#94a3b8',
};

/**
 * Grafo radiale delle relazioni di un'entità: il nodo centrale e i collegati attorno.
 * Toccando un nodo si emette il suo id (l'inspector decide dove portare).
 */
@Component({
  selector: 'app-rel-graph',
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" role="group" aria-label="Grafo delle relazioni">
      <ellipse [attr.cx]="cx" [attr.cy]="cy" [attr.rx]="rx" [attr.ry]="ry" class="orbit" />
      @for (n of laid(); track n.id) {
        <line [attr.x1]="cx" [attr.y1]="cy" [attr.x2]="n.x" [attr.y2]="n.y" class="edge" />
      }
      @for (n of laid(); track n.id) {
        <g class="node" (click)="pick.emit(n.id)" (keydown.enter)="pick.emit(n.id)" tabindex="0" role="button" [attr.aria-label]="n.label">
          <circle [attr.cx]="n.x" [attr.cy]="n.y" r="6" [style.fill]="n.color" />
          <text [attr.x]="n.x + n.dx" [attr.y]="n.y - 2" [attr.text-anchor]="n.anchor" class="lbl">{{ n.label }}</text>
          @if (n.sub) {
            <text [attr.x]="n.x + n.dx" [attr.y]="n.y + 10" [attr.text-anchor]="n.anchor" class="sub">{{ n.sub }}</text>
          }
        </g>
      }
      <g class="center">
        <circle [attr.cx]="cx" [attr.cy]="cy" r="13" [style.fill]="centerColor()" />
        <circle [attr.cx]="cx" [attr.cy]="cy" r="19" class="halo" [style.stroke]="centerColor()" />
        <text [attr.x]="cx" [attr.y]="cy + 34" text-anchor="middle" class="lbl strong">{{ center().label }}</text>
      </g>
    </svg>
    <div class="legend mono">
      @for (k of kinds(); track k.kind) {
        <span><i [style.background]="k.color"></i>{{ k.label }}</span>
      }
    </div>
  `,
  styles: `
    svg {
      display: block;
      width: 100%;
      height: auto;
      background:
        radial-gradient(circle at center, var(--accent-soft), transparent 60%),
        var(--surface-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }
    .orbit {
      fill: none;
      stroke: var(--line-strong);
      stroke-dasharray: 2 4;
    }
    .edge {
      stroke: var(--line-strong);
      stroke-width: 1;
    }
    .node {
      cursor: pointer;
      outline: none;
    }
    .node:hover circle,
    .node:focus-visible circle {
      stroke: var(--text);
      stroke-width: 2;
    }
    .node:hover .lbl {
      fill: var(--accent);
    }
    .halo {
      fill: none;
      stroke-width: 1;
      opacity: 0.5;
    }
    .lbl {
      fill: var(--text);
      font-size: 10.5px;
    }
    .lbl.strong {
      font-weight: 650;
      font-size: 11.5px;
    }
    .sub {
      fill: var(--muted);
      font-family: var(--mono);
      font-size: 9px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      margin-top: 4px;
      font-size: 0.66rem;
      color: var(--muted);
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .legend i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
  `,
})
export class RelGraph {
  readonly center = input.required<{ label: string; kind: GraphNode['kind'] }>();
  readonly nodes = input.required<GraphNode[]>();
  readonly pick = output<string>();

  protected readonly w = W;
  protected readonly h = H;
  protected readonly cx = CX;
  protected readonly cy = CY;
  protected readonly rx = RX;
  protected readonly ry = RY;

  protected centerColor = computed(() => COLORS[this.center().kind]);

  /** Disposizione radiale su un'ellisse; le etichette stanno dalla parte esterna. */
  protected laid = computed(() => {
    const list = this.nodes().slice(0, 10);
    const n = list.length;
    return list.map((node, i) => {
      const a = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2 + (n % 2 ? 0 : Math.PI / n);
      const x = CX + Math.cos(a) * RX;
      const y = CY + Math.sin(a) * RY;
      const right = Math.cos(a) >= 0;
      return {
        ...node,
        x,
        y,
        color: COLORS[node.kind],
        dx: right ? 10 : -10,
        anchor: right ? 'start' : 'end',
        label: node.label.length > MAX_LABEL ? node.label.slice(0, MAX_LABEL - 1) + '…' : node.label,
      };
    });
  });

  protected kinds = computed(() => {
    const names: Record<GraphNode['kind'], string> = {
      quake: 'evento',
      region: 'regione',
      province: 'provincia',
      place: 'luogo',
      city: 'capoluogo',
      data: 'dato',
    };
    const used = new Set([this.center().kind, ...this.nodes().map(n => n.kind)]);
    return [...used].map(kind => ({ kind, label: names[kind], color: COLORS[kind] }));
  });
}
