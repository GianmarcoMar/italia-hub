import { Component, HostBinding, inject } from '@angular/core';
import { ActionsService } from './core/actions.service';
import { Inspector } from './inspector/inspector';
import { MapView } from './map/map-view';
import { PaletteService } from './core/palette.service';
import { SelectionService } from './core/selection.service';
import { ThemeService } from './core/theme.service';
import { UiService } from './core/ui.service';
import { UrlStateService } from './core/url-state.service';
import { CommandPalette } from './shell/command-palette';
import { Feed } from './shell/feed';
import { LayersPanel } from './shell/layers-panel';
import { SourcesDialog } from './shell/sources-dialog';
import { StatusBar } from './shell/status';
import { Timeline } from './shell/timeline';

/**
 * Una sola schermata: la mappa a pieno schermo, con sopra la barra dei comandi, il pannello dei layer,
 * il dossier dell'entità selezionata e la timeline. Niente rotte né schede.
 */
@Component({
  selector: 'app-root',
  imports: [MapView, Inspector, CommandPalette, Feed, LayersPanel, SourcesDialog, StatusBar, Timeline],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected theme = inject(ThemeService);
  protected palette = inject(PaletteService);
  protected sel = inject(SelectionService);
  protected ui = inject(UiService);
  protected actions = inject(ActionsService);

  /** I controlli della mappa si spostano per non finire sotto il dossier. */
  @HostBinding('class.has-panel') get hasPanel() {
    return this.sel.panelOpen();
  }

  constructor() {
    // legge lo stato dall'URL prima che la mappa venga creata
    inject(UrlStateService);
  }
}
