import { Injectable, inject } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { ApisService } from './apis.service';
import { Comune } from './census';
import { CensusService } from './census.service';
import { Feature, GeoService, ProvinceProps, bbox } from './geo.service';
import { Region, regionByCode } from './italy';
import { LocationService } from './location.service';
import { MapService } from './map.service';
import { Place, Quake, containsPoint } from './parsers';
import { SelectionService } from './selection.service';

/**
 * Azioni dell'analista, usate da mappa, pannelli, feed e palette dei comandi:
 * selezionano un'entità e spostano la mappa di conseguenza.
 */
@Injectable({ providedIn: 'root' })
export class ActionsService {
  private api = inject(ApisService);
  private geo = inject(GeoService);
  private loc = inject(LocationService);
  private mapSvc = inject(MapService);
  private sel = inject(SelectionService);
  private census = inject(CensusService);

  focusQuake(q: Quake) {
    this.sel.selectQuake(q.id);
    this.mapSvc.showQuakes.set(true);
    this.mapSvc.flyTo(q.lat, q.lon, Math.max(this.mapSvc.zoom() ?? 8, 8));
  }

  focusRegion(code: number) {
    this.sel.selectRegion(code);
    const f = this.geo.regions.hasValue()
      ? this.geo.regions.value().features.find(x => x.properties.reg_istat_code_num === code)
      : undefined;
    if (f) this.mapSvc.fitBox(bbox(f.geometry));
  }

  focusProvince(code: number) {
    this.sel.selectProvince(code);
    const f = this.geo.provinces.hasValue()
      ? this.geo.provinces.value().features.find(x => x.properties.prov_istat_code_num === code)
      : undefined;
    if (f) this.mapSvc.fitBox(bbox(f.geometry));
  }

  /**
   * Seleziona un comune: diventa anche la località (meteo e schede tematiche lo seguono).
   * `fly` = inquadrarlo (non serve quando l'utente ci ha appena cliccato sopra).
   */
  focusComune(c: Comune, fly = true) {
    this.census.ensureGeo(c.reg);
    this.sel.selectComune(c.k);
    const region = regionByCode(c.reg)?.name ?? '';
    this.loc.selectPlace({ name: c.name, detail: `${c.provAcr} · ${region}`, lat: c.y, lon: c.x });
    if (!fly) return;
    const f = this.census.featureOf(c.k);
    if (f) this.mapSvc.fitBox(bbox(f.geometry));
    else this.mapSvc.flyTo(c.y, c.x, 12);
  }

  focusComuneByCode(k: string) {
    const c = this.census.comuni().get(k);
    if (c) this.focusComune(c);
  }

  focusItaly() {
    this.sel.selectItaly();
    this.mapSvc.fitItaly();
  }

  /**
   * Un punto qualunque della mappa (clic, ricerca): se cade in un comune si apre il suo dossier,
   * altrimenti (mare, estero) il punto stesso. `place` conserva il nome già noto (es. dalla ricerca).
   */
  focusPoint(lat: number, lon: number, place?: Place) {
    const pick = () => {
      if (place) this.loc.selectPlace(place);
      else this.loc.selectPoint(lat, lon);
      this.sel.selectPlace();
    };
    if (!this.geo.regionAt(lat, lon)) return pick();
    forkJoin([this.census.comuneAt(lat, lon), this.census.whenReady()]).subscribe(([f]) => {
      const c = f ? this.census.comuni().get(f.properties.k) : undefined;
      if (c) this.focusComune(c, false);
      else pick();
    });
  }

  goPlace(p: Place, zoom = 11) {
    this.mapSvc.flyTo(p.lat, p.lon, zoom);
    this.focusPoint(p.lat, p.lon, p);
  }

  goCapital(region: Region | number) {
    const r = typeof region === 'number' ? regionByCode(region) : region;
    if (!r) return;
    const c = r.capital;
    this.goPlace({ name: c.name, detail: `${r.name}, Italia`, lat: c.lat, lon: c.lon, nameEn: c.en });
  }

  /**
   * Inquadra la provincia e seleziona il capoluogo omonimo, verificando che cada davvero dentro i confini
   * (es. "Sud Sardegna" non è un comune). Altrimenti seleziona il centro del riquadro.
   */
  goProvince(p: Feature<ProvinceProps>) {
    const box = bbox(p.geometry);
    this.mapSvc.fitBox(box);
    this.sel.selectPlace();
    const name = p.properties.prov_name.split(/[-/]/)[0].trim();
    this.api
      .geocode(name)
      .pipe(catchError(() => of([])))
      .subscribe(found => {
        const inside = found.find(f => containsPoint(p.geometry, f.lat, f.lon));
        if (inside) this.loc.selectPlace(inside);
        else this.loc.selectPoint((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
      });
  }
}
