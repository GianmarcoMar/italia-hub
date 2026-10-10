import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { SOURCES } from '../core/sources';
import { UiService } from '../core/ui.service';

/** Finestra con le fonti, le licenze e i limiti d'uso (si apre da "Fonti" in alto o dalla palette). */
@Component({
  selector: 'app-sources-dialog',
  template: `
    @if (ui.sourcesOpen()) {
      <div class="backdrop" (click)="close()" (keydown.escape)="close()" role="presentation">
        <section class="dialog" role="dialog" aria-modal="true" aria-label="Fonti e licenze" tabindex="-1" #dlg (click)="$event.stopPropagation()">
          <header>
            <h2>Fonti e licenze</h2>
            <button type="button" class="x" (click)="close()" aria-label="Chiudi">✕</button>
          </header>
          <p class="muted small">
            Italia Hub unisce solo fonti pubbliche, gratuite e senza chiave. Ecco da dove arriva ogni dato, con licenza e limiti
            d'uso.
          </p>
          <div class="list">
            @for (s of sources; track s.name) {
              <article>
                <h3>{{ s.name }}</h3>
                <p class="muted small">{{ s.area }}</p>
                <span class="badge">{{ s.license }}</span>
                <p class="small limits">{{ s.limits }}</p>
                <a [href]="s.url" target="_blank" rel="noopener" class="small">Condizioni e documentazione ↗</a>
              </article>
            }
          </div>
          <p class="muted small">
            La licenza INGV, segnata «da verificare», non è stata controllata alla fonte: leggila prima di pubblicare. Open-Meteo è
            gratis solo per uso non commerciale. Progetto personale, senza scopo di lucro.
          </p>
        </section>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 1300;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.5);
    }
    .dialog {
      display: grid;
      gap: 12px;
      width: min(760px, 100%);
      max-height: 100%;
      overflow-y: auto;
      padding: 16px 18px 18px;
      background: var(--surface);
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      box-shadow: var(--shadow-md);
      outline: none;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h2 {
      margin: 0;
    }
    h3 {
      margin: 0 0 2px;
      font-size: 0.9rem;
    }
    .x {
      border: 0;
      background: none;
      color: var(--muted);
      font-size: 1rem;
      cursor: pointer;
    }
    .x:hover {
      color: var(--text);
    }
    .list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 10px;
    }
    article {
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-2);
    }
    .limits {
      margin: 4px 0;
    }
  `,
})
export class SourcesDialog {
  protected ui = inject(UiService);
  protected sources = SOURCES;
  private dlg = viewChild<ElementRef<HTMLElement>>('dlg');

  constructor() {
    // il focus entra nella finestra: Esc la chiude
    effect(() => {
      if (this.ui.sourcesOpen()) setTimeout(() => this.dlg()?.nativeElement.focus());
    });
  }

  protected close() {
    this.ui.sourcesOpen.set(false);
  }
}
