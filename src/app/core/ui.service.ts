import { Injectable, signal } from '@angular/core';

/** Stato dei pannelli sovrapposti alla mappa. */
@Injectable({ providedIn: 'root' })
export class UiService {
  /** Pannello dei layer: aperto su desktop, chiuso su mobile (dove copre la mappa). */
  readonly railOpen = signal(!window.matchMedia('(max-width: 860px)').matches);
  readonly sourcesOpen = signal(false);
}
