import { Injectable, inject, signal } from '@angular/core';
import type * as L from 'leaflet';
import { Choropleth } from './analysis';
import { ITALY_BOUNDS } from './italy';
import { UiService } from './ui.service';

/**
 * Ponte tra i pannelli e la mappa: i pannelli chiedono di spostare la vista o di mostrare
 * un layer, il componente mappa (map-view.ts) esegue.
 */
@Injectable({ providedIn: 'root' })
export class MapService {
  private ui = inject(UiService);

  /** Istanza Leaflet, impostata dal componente mappa quando è pronto. */
  readonly map = signal<L.Map | undefined>(undefined);

  readonly showBorders = signal(true);
  readonly showProvinces = signal(true);
  readonly showWeather = signal(true);
  readonly showQuakes = signal(true);
  /** Confini dei comuni (canvas): visibili da vicino o con una coropleta comunale. */
  readonly showComuni = signal(true);
  /** Zone d'allerta della Protezione Civile e giorno mostrato. */
  readonly showAlerts = signal(false);
  readonly alertDay = signal<'today' | 'tomorrow'>('today');
  readonly choropleth = signal<Choropleth>('none');

  /** Zoom corrente, aggiornato dalla mappa (serve all'URL e all'HUD). */
  readonly zoom = signal<number | null>(null);
  /** Centro della vista, aggiornato a fine spostamento (serve all'URL). */
  readonly center = signal<{ lat: number; lon: number } | null>(null, { equal: (a, b) => a?.lat === b?.lat && a?.lon === b?.lon });

  /** Vista iniziale chiesta dall'URL, letta dalla mappa all'avvio. */
  initialView: { lat: number; lon: number; z: number } | null = null;

  /**
   * Parte della mappa coperta dai pannelli (pixel). Si assume che il dossier si apra: ogni spostamento
   * della vista segue una selezione, e il dossier compare subito dopo.
   */
  private insets() {
    const w = window.innerWidth;
    if (w <= 860) return { l: 0, r: 0, t: 64, b: Math.round(window.innerHeight * 0.58) };
    const rail = document.querySelector<HTMLElement>('.rail');
    return {
      l: this.ui.railOpen() ? (rail?.offsetWidth ?? 270) + 20 : 0,
      r: Math.min(430, w - 20) + 20,
      t: 64,
      b: document.querySelector('.timebar') ? 122 : 8,
    };
  }

  /** Porta il punto al centro dell'area libera, non della mappa intera. */
  flyTo(lat: number, lon: number, zoom = 10) {
    const map = this.map();
    if (!map) return;
    const i = this.insets();
    const target = map.project([lat, lon], zoom).add([(i.r - i.l) / 2, (i.b - i.t) / 2]);
    map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.8 });
  }

  /** bounds: [sud, ovest, nord, est] */
  fitBox([s, w, n, e]: [number, number, number, number]) {
    this.fit([
      [s, w],
      [n, e],
    ]);
  }

  fitItaly(animate = true) {
    this.fit(ITALY_BOUNDS, animate);
  }

  private fit(bounds: L.LatLngBoundsExpression, animate = true) {
    const i = this.insets();
    const options = { paddingTopLeft: [i.l + 24, i.t + 24] as [number, number], paddingBottomRight: [i.r + 24, i.b + 24] as [number, number] };
    if (animate) this.map()?.flyToBounds(bounds, { ...options, duration: 0.8 });
    else this.map()?.fitBounds(bounds, options);
  }
}
