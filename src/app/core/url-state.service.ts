import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { ViewState, parseView, serializeView } from './analysis';
import { MapService } from './map.service';
import { SelectionService } from './selection.service';
import { QuakeStore } from './stores';

/** Ritardo prima di scrivere l'URL: durante il replay della timeline lo stato cambia a ogni frame. */
const WRITE_DELAY = 500;

/**
 * Vista condivisibile: centro e zoom della mappa, filtri sismici, finestra temporale, coropleta ed entità
 * selezionata vivono nei query param. All'avvio si leggono, poi l'URL segue lo stato.
 */
@Injectable({ providedIn: 'root' })
export class UrlStateService {
  private mapSvc = inject(MapService);
  private quakes = inject(QuakeStore);
  private sel = inject(SelectionService);

  /** Va iniettato all'avvio (App), prima che la mappa venga creata: legge subito l'URL. */
  constructor() {
    const params = Object.fromEntries(new URLSearchParams(location.search)) as Record<string, string>;
    this.apply(parseView(params));

    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const state = this.current();
      clearTimeout(timer);
      timer = setTimeout(() => this.write(state), WRITE_DELAY);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  /** Riscrive i query param dell'URL senza aggiungere voci alla cronologia. */
  private write(state: ViewState) {
    const url = new URL(location.href);
    for (const [k, v] of Object.entries(serializeView(state))) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    if (url.search === location.search) return;
    history.replaceState(null, '', url);
  }

  private apply(s: ViewState) {
    if (s.lat !== undefined && s.lon !== undefined && s.z !== undefined) this.mapSvc.initialView = { lat: s.lat, lon: s.lon, z: s.z };
    if (s.source) this.quakes.source.set(s.source);
    if (s.days) this.quakes.days.set(s.days);
    if (s.minMag !== undefined) this.quakes.minMag.set(s.minMag);
    if (s.window) {
      this.quakes.window(); // la finestra si azzera al cambio filtri: prima la si ricalcola, poi la si imposta
      this.quakes.window.set(s.window);
    }
    if (s.choro) this.mapSvc.choropleth.set(s.choro);
    if (s.sel) this.sel.selected.set(s.sel);
  }

  private current(): ViewState {
    const c = this.mapSvc.center();
    const s = this.sel.selected();
    return {
      lat: c?.lat,
      lon: c?.lon,
      z: this.mapSvc.zoom() ?? undefined,
      window: this.quakes.window() ?? undefined,
      source: this.quakes.source(),
      days: this.quakes.days(),
      minMag: this.quakes.minMag(),
      choro: this.mapSvc.choropleth(),
      sel: s.kind === 'place' ? undefined : s,
    };
  }
}
