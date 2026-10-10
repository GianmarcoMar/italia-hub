import type * as L from 'leaflet';
import { ALERT_LABEL, AlertZone } from '../core/alerts';
import { depthColor } from '../core/format';
import { Quake } from '../core/parsers';

/** Zoom e livello del clic: sotto 7 regione, da 7 a 9 provincia, da 9 comune. */
export const DRILL_ZOOM = 7;
export const COMUNE_ZOOM = 9;

/** Da questo zoom in giù la mappa è "da lontano": confini comunali quasi invisibili, colori più pieni. */
export const FAR_ZOOM = 8;

/**
 * Opzioni GeoJSON con renderer: Leaflet le passa a ogni poligono (che accetta `renderer`),
 * ma i tipi di GeoJSONOptions non lo dichiarano.
 */
export type CanvasGeoJSONOptions<P> = L.GeoJSONOptions<P> & { renderer?: L.Renderer };

/** Valore di una variabile CSS del tema (il canvas di Leaflet vuole colori espliciti). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#2dd4bf';
}

/**
 * Stile di un comune: riempito dalla coropleta, bordo forte se selezionato.
 * Da lontano i bordi quasi spariscono, altrimenti 7.896 contorni coprono i colori.
 */
export function comuneStyle(fill: string | undefined, selected: boolean, accent: string, line: string, far = false): L.PathOptions {
  return {
    color: selected ? accent : line,
    weight: selected ? 2.5 : far ? (fill ? 0 : 0.3) : 0.6,
    opacity: 1,
    fill: true,
    fillColor: fill ?? accent,
    fillOpacity: fill ? (far ? 0.78 : 0.68) : selected ? 0.12 : 0,
  };
}

/**
 * Tooltip costruito come DOM (titolo e riga secondaria opzionale): il testo che arriva dalle API
 * non viene mai interpretato come HTML.
 */
export function tip(title: string, detail?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qtip';
  const t = document.createElement('strong');
  t.textContent = title;
  el.append(t);
  if (detail !== undefined) {
    const s = document.createElement('span');
    s.textContent = detail;
    el.append(s);
  }
  return el;
}

/** Tooltip di una zona d'allerta (testo dal bollettino). */
export const alertTip = (z: AlertZone): HTMLElement => tip(z.name, z.level ? z.summary : ALERT_LABEL[0]);

export function quakeTip(q: Quake): HTMLElement {
  const when = new Date(q.time).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  return tip(`M ${q.mag.toFixed(1)} · ${q.place}`, `${when}${q.depthKm === null ? '' : ` · ${q.depthKm.toFixed(0)} km`}`);
}

export const quakeStyle = (q: Quake, hot: boolean): L.CircleMarkerOptions => ({
  radius: Math.max(3, 2 + q.mag * 2.2),
  color: depthColor(q.depthKm),
  fillColor: depthColor(q.depthKm),
  fillOpacity: hot ? 0.85 : 0.3,
  weight: hot ? 3 : 1.5,
});

/** Codici ISTAT delle regioni in ordine di popolazione del capoluogo: chi vince quando le etichette si toccano. */
export const PRIORITY = [12, 3, 15, 1, 19, 7, 8, 9, 16, 5, 20, 6, 10, 18, 11, 4, 17, 13, 14, 2];
