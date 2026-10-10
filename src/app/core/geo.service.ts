import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { containsPoint } from './parsers';

/**
 * Confini amministrativi ISTAT (CC BY 4.0) da github.com/guglielmo/geojson-italy, vintage 1/1/2026,
 * semplificati al 4% con mapshaper e serviti come file statici da public/geo.
 */

export interface Geometry {
  type: string;
  coordinates: any;
}

export interface Feature<P> {
  type: 'Feature';
  properties: P;
  geometry: Geometry;
}

export interface FeatureCollection<P> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}

export interface RegionProps {
  reg_name: string;
  reg_istat_code_num: number;
}

export interface ProvinceProps {
  prov_name: string;
  prov_acr: string;
  prov_istat_code_num: number;
  reg_istat_code_num: number;
}

/** Riquadro [sud, ovest, nord, est] di una geometria, per il pre-filtro e per centrare la mappa. */
export function bbox(g: Geometry): [number, number, number, number] {
  let s = 90, w = 180, n = -90, e = -180;
  const walk = (c: any): void => {
    if (typeof c[0] === 'number') {
      const [lon, lat] = c;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
    } else c.forEach(walk);
  };
  walk(g.coordinates);
  return [s, w, n, e];
}

interface Indexed<P> {
  feature: Feature<P>;
  box: [number, number, number, number];
}

function index<P>(fc: FeatureCollection<P>): Indexed<P>[] {
  return fc.features.map(feature => ({ feature, box: bbox(feature.geometry) }));
}

function find<P>(list: Indexed<P>[], lat: number, lon: number): Feature<P> | null {
  for (const { feature, box } of list) {
    const [s, w, n, e] = box;
    if (lat < s || lat > n || lon < w || lon > e) continue;
    if (containsPoint(feature.geometry, lat, lon)) return feature;
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class GeoService {
  private http = inject(HttpClient);

  // senza params: si caricano una sola volta, al primo uso
  readonly regions = rxResource({
    stream: () => this.http.get<FeatureCollection<RegionProps>>('geo/regioni.geojson'),
  });

  readonly provinces = rxResource({
    stream: () => this.http.get<FeatureCollection<ProvinceProps>>('geo/province.geojson'),
  });

  private regionIndex?: Indexed<RegionProps>[];
  private provinceIndex?: Indexed<ProvinceProps>[];

  /** Regione che contiene il punto (null fuori dall'Italia, in mare o se i dati non sono ancora arrivati). */
  regionAt(lat: number, lon: number): Feature<RegionProps> | null {
    if (!this.regions.hasValue()) return null;
    this.regionIndex ??= index(this.regions.value());
    return find(this.regionIndex, lat, lon);
  }

  provinceAt(lat: number, lon: number): Feature<ProvinceProps> | null {
    if (!this.provinces.hasValue()) return null;
    this.provinceIndex ??= index(this.provinces.value());
    return find(this.provinceIndex, lat, lon);
  }

  provincesOf(regionCode: number): Feature<ProvinceProps>[] {
    if (!this.provinces.hasValue()) return [];
    return this.provinces
      .value()
      .features.filter(f => f.properties.reg_istat_code_num === regionCode)
      .sort((a, b) => a.properties.prov_name.localeCompare(b.properties.prov_name, 'it'));
  }
}
