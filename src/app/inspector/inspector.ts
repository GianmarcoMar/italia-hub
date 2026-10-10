import { Component, computed, inject } from '@angular/core';
import { regionByCode } from '../core/italy';
import { ActionsService } from '../core/actions.service';
import { CensusService } from '../core/census.service';
import { GeoService } from '../core/geo.service';
import { LocationService } from '../core/location.service';
import { Entity, SelectionService } from '../core/selection.service';
import { ComuneEntity } from './comune-entity';
import { ItalyEntity } from './italy-entity';
import { PlaceEntity } from './place-entity';
import { ProvinceEntity } from './province-entity';
import { QuakeEntity } from './quake-entity';
import { RegionEntity } from './region-entity';

interface Crumb {
  label: string;
  on: boolean;
  go: () => void;
}

/**
 * Dossier sovrapposto alla mappa: la scheda dell'entità selezionata (Italia, regione, provincia,
 * comune, evento sismico o punto). Si chiude con ✕; ogni nuova selezione lo riapre.
 */
@Component({
  selector: 'app-inspector',
  imports: [QuakeEntity, RegionEntity, ProvinceEntity, ComuneEntity, ItalyEntity, PlaceEntity],
  template: `
    <header class="bar">
      <nav class="crumbs mono" aria-label="Percorso">
        @for (c of crumbs(); track $index; let last = $last) {
          <button type="button" (click)="c.go()" [class.on]="c.on">{{ c.label }}</button>
          @if (!last) {
            <span>›</span>
          }
        }
      </nav>
      <button type="button" class="close" (click)="sel.closePanel()" aria-label="Chiudi il dossier" title="Chiudi">✕</button>
    </header>

    <div class="body">
      @switch (sel.selected().kind) {
        <!-- schede delle entità in pezzi separati del bundle, caricati alla prima selezione -->
        @case ('quake') {
          @defer {
            <app-quake-entity [id]="quakeId()" />
          } @placeholder {
            <div class="skeleton" style="height: 240px"></div>
          }
        }
        @case ('region') {
          @defer {
            <app-region-entity [code]="regionCode()" />
          } @placeholder {
            <div class="skeleton" style="height: 240px"></div>
          }
        }
        @case ('province') {
          @defer {
            <app-province-entity [code]="provinceCode()" />
          } @placeholder {
            <div class="skeleton" style="height: 240px"></div>
          }
        }
        @case ('comune') {
          @defer {
            <app-comune-entity [code]="comuneCode()" />
          } @placeholder {
            <div class="skeleton" style="height: 240px"></div>
          }
        }
        @case ('italy') {
          @defer {
            <app-italy-entity />
          } @placeholder {
            <div class="skeleton" style="height: 240px"></div>
          }
        }
        @default {
          @defer {
            <app-place-entity />
          } @placeholder {
            <div class="skeleton" style="height: 240px"></div>
          }
        }
      }
    </div>
  `,
  styleUrl: './inspector.css',
})
export class Inspector {
  protected loc = inject(LocationService);
  protected sel = inject(SelectionService);
  protected actions = inject(ActionsService);
  private census = inject(CensusService);
  private geo = inject(GeoService);

  /** Codici ISTAT di regione e provincia dell'entità selezionata; per le altre, quelli della località. */
  private territory(s: Entity): { reg?: number; prov?: number } {
    if (s.kind === 'region') return { reg: s.code };
    if (s.kind === 'province') return { reg: this.geo.provinceFeature(s.code)?.properties.reg_istat_code_num, prov: s.code };
    const comune = s.kind === 'comune' ? this.census.comuni().get(s.code) : undefined;
    if (comune) return { reg: comune.reg, prov: comune.prov };
    return { reg: this.loc.region()?.code, prov: this.loc.province()?.prov_istat_code_num };
  }

  /** Percorso Italia › regione › provincia › comune (o punto / evento), ogni livello cliccabile. */
  protected crumbs = computed(() => {
    const s = this.sel.selected();
    const out: Crumb[] = [{ label: 'ITALIA', on: s.kind === 'italy', go: () => this.actions.focusItaly() }];
    if (s.kind === 'italy') return out;

    const { reg: regCode, prov: provCode } = this.territory(s);
    const reg = regionByCode(regCode);
    if (reg) out.push({ label: reg.name.toUpperCase(), on: s.kind === 'region', go: () => this.actions.focusRegion(reg.code) });
    if (s.kind === 'region') return out;

    const provName = this.geo.provinceFeature(provCode)?.properties.prov_name;
    if (provName && provCode) out.push({ label: provName.toUpperCase(), on: s.kind === 'province', go: () => this.actions.focusProvince(provCode) });
    if (s.kind === 'province') return out;

    const comune = s.kind === 'comune' ? this.census.comuni().get(s.code) : undefined;
    if (comune) out.push({ label: comune.name.toUpperCase(), on: true, go: () => this.actions.focusComune(comune) });
    else out.push({ label: this.loc.place().name.toUpperCase(), on: s.kind === 'place', go: () => this.sel.selectPlace() });
    if (s.kind === 'quake') out.push({ label: 'EVENTO', on: true, go: () => undefined });
    return out;
  });

  /** Parametro di ciascuna scheda: il valore dell'entità selezionata se è del tipo giusto, altrimenti un segnaposto. */
  protected quakeId = computed(() => {
    const s = this.sel.selected();
    return s.kind === 'quake' ? s.id : '';
  });
  protected regionCode = computed(() => {
    const s = this.sel.selected();
    return s.kind === 'region' ? s.code : 0;
  });
  protected provinceCode = computed(() => {
    const s = this.sel.selected();
    return s.kind === 'province' ? s.code : 0;
  });
  protected comuneCode = computed(() => {
    const s = this.sel.selected();
    return s.kind === 'comune' ? s.code : '';
  });
}
