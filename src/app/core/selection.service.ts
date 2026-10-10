import { Injectable, computed, signal } from '@angular/core';
import { SelState } from './analysis';

/**
 * Entità selezionata nella console. L'inspector mostra la sua scheda; mappa, elenchi e timeline
 * la evidenziano. "place" = un punto qualunque (mare, estero, risultato di ricerca) senza comune.
 * Gerarchia territoriale: Italia → regione → provincia → comune.
 */
export type Entity = { kind: 'place' } | SelState;

@Injectable({ providedIn: 'root' })
export class SelectionService {
  readonly selected = signal<Entity>({ kind: 'place' });

  /**
   * Selezione che l'utente ha chiuso: finché è quella corrente il pannello resta nascosto.
   * Ogni `select*` crea un oggetto nuovo, quindi anche riselezionare la stessa cosa riapre il pannello.
   * All'avvio la selezione predefinita è già "chiusa": si parte dalla mappa pulita.
   */
  private readonly dismissed = signal<Entity | null>(this.selected());
  readonly panelOpen = computed(() => this.dismissed() !== this.selected());

  /** Evento sotto il puntatore, in mappa o in un elenco: si evidenzia ovunque. */
  readonly hoveredQuake = signal<string | null>(null);

  closePanel() {
    this.dismissed.set(this.selected());
  }

  selectPlace() {
    this.selected.set({ kind: 'place' });
  }

  selectQuake(id: string) {
    this.selected.set({ kind: 'quake', id });
  }

  selectRegion(code: number) {
    this.selected.set({ kind: 'region', code });
  }

  selectProvince(code: number) {
    this.selected.set({ kind: 'province', code });
  }

  selectComune(code: string) {
    this.selected.set({ kind: 'comune', code });
  }

  selectItaly() {
    this.selected.set({ kind: 'italy' });
  }

  isQuake(id: string) {
    const s = this.selected();
    return s.kind === 'quake' && s.id === id;
  }
}
