import { Component, computed, inject } from '@angular/core';
import { regionByCode } from '../core/italy';
import { ActionsService } from '../core/actions.service';
import { CensusService } from '../core/census.service';
import { GeoService } from '../core/geo.service';
import { LocationService } from '../core/location.service';
import { SelectionService } from '../core/selection.service';
import { ComuneEntity } from './comune-entity';
import { ItalyEntity } from './italy-entity';
import { PlaceEntity } from './place-entity';
import { ProvinceEntity } from './province-entity';
import { QuakeEntity } from './quake-entity';
import { RegionEntity } from './region-entity';

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

  /**
   * Percorso Italia › regione › provincia › comune (o punto / evento), ogni livello cliccabile.
   * Regione e provincia vengono dall'entità selezionata, altrimenti dalla località.
   */
  protected crumbs = computed(() => {
    const s = this.sel.selected();
    const out: { label: string; on: boolean; go: () => void }[] = [
      { label: 'ITALIA', on: s.kind === 'italy', go: () => this.actions.focusItaly() },
    ];
    const comune = s.kind === 'comune' ? this.census.comuni().get(s.code) : undefined;
    const regCode =
      s.kind === 'region' ? s.code : s.kind === 'province' ? this.provinceRegion(s.code) : comune ? comune.reg : this.loc.region()?.code;
    const provCode = s.kind === 'province' ? s.code : comune ? comune.prov : s.kind === 'region' ? undefined : this.loc.province()?.prov_istat_code_num;
    if (s.kind === 'italy') return out;
    const reg = regionByCode(regCode);
    if (reg) out.push({ label: reg.name.toUpperCase(), on: s.kind === 'region', go: () => this.actions.focusRegion(reg.code) });
    if (s.kind === 'region') return out;
    const prov = provCode ? this.provinceName(provCode) : null;
    if (prov && provCode) out.push({ label: prov.toUpperCase(), on: s.kind === 'province', go: () => this.actions.focusProvince(provCode) });
    if (s.kind === 'province') return out;
    if (comune) out.push({ label: comune.name.toUpperCase(), on: true, go: () => this.actions.focusComune(comune) });
    else out.push({ label: this.loc.place().name.toUpperCase(), on: s.kind === 'place', go: () => this.sel.selectPlace() });
    if (s.kind === 'quake') out.push({ label: 'EVENTO', on: true, go: () => undefined });
    return out;
  });

  private provinceFeature(code: number) {
    return this.geo.provinces.hasValue() ? this.geo.provinces.value().features.find(f => f.properties.prov_istat_code_num === code) : undefined;
  }

  private provinceRegion(code: number) {
    return this.provinceFeature(code)?.properties.reg_istat_code_num;
  }

  private provinceName(code: number) {
    return this.provinceFeature(code)?.properties.prov_name ?? null;
  }

  protected quakeId() {
    const s = this.sel.selected();
    return s.kind === 'quake' ? s.id : '';
  }

  protected regionCode() {
    const s = this.sel.selected();
    return s.kind === 'region' ? s.code : 0;
  }

  protected provinceCode() {
    const s = this.sel.selected();
    return s.kind === 'province' ? s.code : 0;
  }

  protected comuneCode() {
    const s = this.sel.selected();
    return s.kind === 'comune' ? s.code : '';
  }
}
