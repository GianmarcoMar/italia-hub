import { Component, computed, inject } from '@angular/core';
import { AlertsService } from '../core/alerts.service';
import { CHORO_GROUPS, ChoroplethService } from '../core/choropleth.service';
import { MapService } from '../core/map.service';
import { CapitalsWeatherStore, QuakeStore } from '../core/stores';

/** Pannello sinistro: livelli della mappa, filtri sismici e coropleta. */
@Component({
  selector: 'app-layers-panel',
  template: `
    <section>
      <h3>Layer</h3>
      <label class="layer">
        <input type="checkbox" [checked]="map.showBorders()" (change)="map.showBorders.set(checked($event))" />
        <span>Confini regionali</span>
        <span class="n mono">20</span>
      </label>
      <label class="layer">
        <input type="checkbox" [checked]="map.showProvinces()" (change)="map.showProvinces.set(checked($event))" />
        <span>Province della regione</span>
      </label>
      <label class="layer">
        <input type="checkbox" [checked]="map.showComuni()" (change)="map.showComuni.set(checked($event))" />
        <span>Comuni (da vicino)</span>
        <span class="n mono">7.896</span>
      </label>
      <label class="layer">
        <input type="checkbox" [checked]="map.showAlerts()" (change)="map.showAlerts.set(checked($event))" />
        <span>Zone d'allerta DPC</span>
        @if (map.showAlerts() && alerts.loading()) {
          <span class="n mono busy">…</span>
        }
      </label>
      @if (map.showAlerts()) {
        <div class="seg small-seg" role="group" aria-label="Giorno dell'allerta">
          <button type="button" [class.on]="map.alertDay() === 'today'" (click)="map.alertDay.set('today')">Oggi</button>
          <button type="button" [class.on]="map.alertDay() === 'tomorrow'" (click)="map.alertDay.set('tomorrow')">Domani</button>
        </div>
      }
      <label class="layer">
        <input type="checkbox" [checked]="map.showWeather()" (change)="map.showWeather.set(checked($event))" />
        <span>Meteo capoluoghi</span>
        <span class="n mono">{{ capitalsCount() }}</span>
      </label>
      <label class="layer">
        <input type="checkbox" [checked]="map.showQuakes()" (change)="map.showQuakes.set(checked($event))" />
        <span>Eventi sismici</span>
        <span class="n mono" [class.busy]="quakes.quakes.isLoading()">
          {{ quakes.visible().length }}@if (quakes.window()) {<em>/{{ quakes.list().length }}</em>}
        </span>
      </label>
    </section>

    <section>
      <h3>Filtri sismici</h3>
      <div class="seg" role="group" aria-label="Fonte">
        <button type="button" [class.on]="quakes.source() === 'ingv'" (click)="quakes.source.set('ingv')">INGV · IT</button>
        <button type="button" [class.on]="quakes.source() === 'usgs'" (click)="quakes.source.set('usgs')">USGS · Mondo</button>
      </div>
      <div class="seg" role="group" aria-label="Periodo">
        @for (d of [1, 7, 30]; track d) {
          <button type="button" [class.on]="quakes.days() === d" (click)="quakes.days.set(d)">{{ d === 1 ? '24 h' : d + ' g' }}</button>
        }
      </div>
      <div class="seg" role="group" aria-label="Magnitudo minima">
        @for (m of [1, 2, 3, 4.5]; track m) {
          <button type="button" [class.on]="quakes.minMag() === m" (click)="quakes.minMag.set(m)">M{{ m }}+</button>
        }
      </div>
    </section>

    <section>
      <h3>Analisi · colora la mappa</h3>
      <select aria-label="Indicatore della mappa coropletica" (change)="map.choropleth.set($any($event.target).value)">
        <option value="none" [selected]="map.choropleth() === 'none'">Nessuna colorazione</option>
        @for (g of choroGroups; track g.label) {
          <optgroup [label]="g.label">
            @for (o of g.options; track o.v) {
              <option [value]="o.v" [selected]="map.choropleth() === o.v">{{ o.label }}</option>
            }
          </optgroup>
        }
      </select>
      @if (choro.legend(); as l) {
        <div class="legend">
          <span class="label">
            {{ l.title }}
            @if (choro.loading()) {
              <span class="busy">· caricamento</span>
            }
          </span>
          <div class="steps">
            @for (s of l.steps; track s.label) {
              <span><i [style.background]="s.color"></i>{{ s.label }}</span>
            }
          </div>
          @if (l.note) {
            <p class="muted small">{{ l.note }}</p>
          }
          @if (map.choropleth() === 'quakes' && quakes.window()) {
            <p class="muted small">Conteggio nella finestra della timeline.</p>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: 18px;
    }
    section {
      display: grid;
      gap: 4px;
    }
    .layer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      margin: 0 -6px;
      border-radius: var(--radius);
      font-size: 0.82rem;
      cursor: pointer;
    }
    .layer:hover {
      background: var(--hover);
    }
    .layer input {
      accent-color: var(--accent);
      margin: 0;
    }
    .n {
      margin-left: auto;
      color: var(--accent);
      font-size: 0.75rem;
    }
    .n em {
      color: var(--muted);
      font-style: normal;
    }
    .n.busy {
      color: var(--warn);
    }
    .seg {
      display: flex;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      overflow: hidden;
      margin-bottom: 4px;
    }
    .seg button {
      flex: 1;
      font: inherit;
      font-family: var(--mono);
      font-size: 0.72rem;
      padding: 5px 4px;
      border: 0;
      border-left: 1px solid var(--line-strong);
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .seg button:first-child {
      border-left: 0;
    }
    .seg button:hover {
      background: var(--hover);
    }
    .seg button.on {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
    .legend {
      margin-top: 6px;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-2);
    }
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      font-family: var(--mono);
      font-size: 0.7rem;
    }
    .steps span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .steps i {
      width: 12px;
      height: 8px;
      border-radius: 1px;
    }
    .legend p {
      margin: 6px 0 0;
    }
    .legend .busy {
      color: var(--warn);
    }
    select {
      width: 100%;
      font-size: 0.8rem;
    }
    .small-seg {
      margin: 0 0 4px 22px;
    }
  `,
})
export class LayersPanel {
  protected map = inject(MapService);
  protected quakes = inject(QuakeStore);
  protected choro = inject(ChoroplethService);
  protected alerts = inject(AlertsService);
  private capitals = inject(CapitalsWeatherStore);

  protected readonly choroGroups = CHORO_GROUPS;

  protected capitalsCount = computed(() => this.capitals.list().filter(x => x.now).length);

  protected checked(e: Event) {
    return (e.target as HTMLInputElement).checked;
  }
}
