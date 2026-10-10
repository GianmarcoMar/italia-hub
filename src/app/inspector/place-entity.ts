import { Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LocationService } from '../core/location.service';
import { LivePanel } from './panels/live-panel';

/**
 * Un punto senza comune (mare, estero, risultato di ricerca fuori dai confini): coordinate e situazione
 * in tempo reale. Dentro l'Italia un clic apre il comune, quindi qui si arriva di rado.
 */
@Component({
  selector: 'app-place-entity',
  imports: [DecimalPipe, LivePanel],
  template: `
    <header class="head">
      <div>
        <span class="tag">Punto</span>
        <span class="id mono">{{ loc.place().lat | number: '1.4-4' }}, {{ loc.place().lon | number: '1.4-4' }}</span>
      </div>
      <div class="title">
        <div>
          <h1>
            {{ loc.place().name }}
            @if (loc.resolving()) {
              <span class="dots" aria-label="ricerca del nome"></span>
            }
          </h1>
          <p class="muted small mono">
            @if (loc.province(); as pr) {
              {{ pr.prov_name }} ({{ pr.prov_acr }}) ·
            }
            {{ loc.region()?.name ?? loc.place().detail }}
          </p>
        </div>
      </div>
    </header>

    <section>
      <h3>Situazione in tempo reale</h3>
      <app-live-panel [lat]="loc.coords().lat" [lon]="loc.coords().lon" [radiusKm]="50" />
    </section>
  `,
  styleUrl: './entity.css',
  styles: `
    .dots {
      display: inline-block;
      width: 24px;
      height: 8px;
      margin-left: 6px;
      vertical-align: middle;
      background: radial-gradient(circle, var(--muted) 2px, transparent 2.5px) 0 50% / 8px 8px repeat-x;
      animation: grow 1s steps(3) infinite;
    }
    @keyframes grow {
      from {
        width: 0;
      }
    }
  `,
})
export class PlaceEntity {
  protected loc = inject(LocationService);
}
