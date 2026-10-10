import { Injectable, signal } from '@angular/core';

/** Stato dei pannelli sovrapposti alla mappa. */
@Injectable({ providedIn: 'root' })
export class UiService {
  /** Pannello dei layer: aperto su desktop, chiuso su mobile (dove copre la mappa). */
  readonly railOpen = signal(!window.matchMedia('(max-width: 860px)').matches);
  readonly sourcesOpen = signal(false);
  /** Dashboard di analisi incrociata: aperta e/o ridotta a una pillola (per guardare la mappa). */
  readonly analysisOpen = signal(false);
  readonly analysisMin = signal(false);

  openAnalysis() {
    this.analysisOpen.set(true);
    this.analysisMin.set(false);
  }
}
