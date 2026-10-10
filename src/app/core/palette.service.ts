import { Injectable, signal } from '@angular/core';

/** Apertura della palette dei comandi: il componente è caricato in differita, il pulsante no. */
@Injectable({ providedIn: 'root' })
export class PaletteService {
  readonly open = signal(false);

  toggle() {
    this.open.update(v => !v);
  }
}
