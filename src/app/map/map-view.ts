import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as L from 'leaflet';
import { ActionsService } from '../core/actions.service';
import { ALERT_COLOR, ALERT_LABEL, AlertLevel, AlertZone } from '../core/alerts';
import { AlertsService } from '../core/alerts.service';
import { Comune, metricById } from '../core/census';
import { CensusService, ComuneProps } from '../core/census.service';
import { ChoroplethService } from '../core/choropleth.service';
import { DEPTH_LEGEND, depthColor } from '../core/format';
import { Feature, FeatureCollection, GeoService, ProvinceProps, RegionProps } from '../core/geo.service';
import { ITALY_BOUNDS, REGIONS, Region } from '../core/italy';
import { LocationService } from '../core/location.service';
import { MapService } from '../core/map.service';
import { Quake } from '../core/parsers';
import { SelectionService } from '../core/selection.service';
import { CapitalsWeatherStore, QuakeStore } from '../core/stores';
import { ThemeService } from '../core/theme.service';
import { weatherIcon, weatherLabel } from '../core/weather';

/** Zoom e livello del clic: sotto 7 regione, da 7 a 9 provincia, da 9 comune. */
const DRILL_ZOOM = 7;
const COMUNE_ZOOM = 9;

const ALL_REGIONS = REGIONS.map(r => r.code);

/**
 * Opzioni GeoJSON con renderer: Leaflet le passa a ogni poligono (che accetta `renderer`),
 * ma i tipi di GeoJSONOptions non lo dichiarano.
 */
type CanvasGeoJSONOptions<P> = L.GeoJSONOptions<P> & { renderer?: L.Renderer };

/** Valore di una variabile CSS del tema (il canvas di Leaflet vuole colori espliciti). */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#2dd4bf';
}

/**
 * Stile di un comune: riempito dalla coropleta, bordo forte se selezionato.
 * Da lontano i bordi quasi spariscono, altrimenti 7.896 contorni coprono i colori.
 */
function comuneStyle(fill: string | undefined, selected: boolean, accent: string, line: string, zoom = 9): L.PathOptions {
  const far = zoom < 8;
  return {
    color: selected ? accent : line,
    weight: selected ? 2.5 : far ? (fill ? 0 : 0.3) : 0.6,
    opacity: 1,
    fill: true,
    fillColor: fill ?? accent,
    fillOpacity: fill ? (far ? 0.78 : 0.68) : selected ? 0.12 : 0,
  };
}

/** Tooltip di una zona d'allerta (testo dal bollettino, mai come HTML). */
function alertTip(z: AlertZone): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qtip';
  const t = document.createElement('strong');
  t.textContent = z.name;
  const s = document.createElement('span');
  s.textContent = z.level ? z.summary : ALERT_LABEL[0];
  el.append(t, s);
  return el;
}

/** Codici ISTAT delle regioni in ordine di popolazione del capoluogo: chi vince quando le etichette si toccano. */
const PRIORITY = [12, 3, 15, 1, 19, 7, 8, 9, 16, 5, 20, 6, 10, 18, 11, 4, 17, 13, 14, 2];

/** Tooltip costruito come DOM: il testo che arriva dall'API non viene mai interpretato come HTML. */
function quakeTip(q: Quake): HTMLElement {
  const el = document.createElement('div');
  el.className = 'qtip';
  const title = document.createElement('strong');
  title.textContent = `M ${q.mag.toFixed(1)} · ${q.place}`;
  const meta = document.createElement('span');
  meta.textContent = `${new Date(q.time).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}${
    q.depthKm === null ? '' : ` · ${q.depthKm.toFixed(0)} km`
  }`;
  el.append(title, meta);
  return el;
}

const quakeStyle =(q: Quake, hot: boolean): L.CircleMarkerOptions => ({
  radius: Math.max(3, 2 + q.mag * 2.2),
  color: depthColor(q.depthKm),
  fillColor: depthColor(q.depthKm),
  fillOpacity: hot ? 0.85 : 0.3,
  weight: hot ? 3 : 1.5,
});

@Component({
  selector: 'app-map',
  imports: [DecimalPipe],
  template: `
    <div #el class="map" role="application" aria-label="Mappa interattiva dell'Italia"></div>

    <div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

    <div class="ui bottom-left hud mono" aria-live="off">
      <span class="dot"></span>
      <span>
        MAPPA
        @if (selectedRegionName(); as r) {
          <span class="sep">/</span> {{ r.toUpperCase() }}
        }
      </span>
      <span class="sep">|</span>
      <span>Z{{ zoom() }}</span>
      @if (mapSvc.showQuakes()) {
        <span>EV {{ quakes.visible().length }}</span>
      }
      @if (cursor(); as c) {
        <span class="coord">{{ c.lat | number: '1.4-4' }}, {{ c.lon | number: '1.4-4' }}</span>
      }
    </div>

    <div class="ui top-center legends">
      @if (choro.legend(); as l) {
        <div class="legend mono" aria-label="Legenda della coropleta">
          <span class="label">
            {{ l.title }}
            @if (choro.loading()) {
              <span class="busy">caricamento…</span>
            }
          </span>
          @for (s of l.steps; track s.label) {
            <span><i class="sq" [style.background]="s.color"></i>{{ s.label }}</span>
          }
        </div>
      }
      @if (mapSvc.showQuakes() && quakes.list().length) {
        <div class="legend mono" aria-label="Legenda terremoti">
          <span class="label">Profondità</span>
          @for (d of depthLegend; track d.label) {
            <span><i [style.background]="d.color"></i>{{ d.label }}</span>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './map-view.css',
  // gli elementi creati da Leaflet (tooltip, icone, path) non hanno gli attributi di Angular
  encapsulation: ViewEncapsulation.None,
})
export class MapView {
  private geo = inject(GeoService);
  private loc = inject(LocationService);
  private sel = inject(SelectionService);
  private actions = inject(ActionsService);
  private census = inject(CensusService);
  protected choro = inject(ChoroplethService);
  private alerts = inject(AlertsService);
  private theme = inject(ThemeService);
  protected mapSvc = inject(MapService);
  protected quakes = inject(QuakeStore);
  private capitals = inject(CapitalsWeatherStore);
  private el = viewChild.required<ElementRef<HTMLDivElement>>('el');

  protected readonly depthLegend = DEPTH_LEGEND;
  protected cursor = signal<{ lat: number; lon: number } | null>(null);
  protected zoom = signal(6);

  private map?: L.Map;
  private ready = signal(false);

  private regionLayers = new Map<number, L.Path>();
  private regionsLayer?: L.GeoJSON;
  private provincesLayer = L.layerGroup();
  private weatherLayer = L.layerGroup();
  private quakeLayer = L.layerGroup();
  private quakeMarkers = new Map<string, { m: L.CircleMarker; q: Quake }>();
  /** Cambia quando i marker vengono ricreati, per rieseguire gli effetti che li usano. */
  private markersVersion = signal(0);
  /** Cambia quando i path delle regioni vengono (ri)creati nel DOM. */
  private regionsVersion = signal(0);
  private comuniLayers = new Map<number, L.GeoJSON>();
  private comuniVersion = signal(0);
  private provChoro?: L.GeoJSON;
  private alertLayer?: L.GeoJSON;
  private comuniCanvas?: L.Canvas;
  private provCanvas?: L.Canvas;
  private alertCanvas?: L.Canvas;
  private selRing?: L.CircleMarker;
  private radius?: L.Circle;
  private pin?: L.Marker;
  private lastHot: string | null = null;

  /** Regione evidenziata: quella dell'entità selezionata, altrimenti quella della località. */
  private highlightRegion = computed(() => {
    const s = this.sel.selected();
    if (s.kind === 'region') return s.code;
    if (s.kind === 'province') return this.provinceFeature(s.code)?.properties.reg_istat_code_num ?? null;
    if (s.kind === 'comune') return this.census.comuni().get(s.code)?.reg ?? null;
    if (s.kind === 'italy') return null;
    return this.loc.regionFeature()?.properties.reg_istat_code_num ?? null;
  });

  /** Provincia evidenziata (entità provincia o provincia del comune selezionato). */
  private highlightProvince = computed(() => {
    const s = this.sel.selected();
    if (s.kind === 'province') return s.code;
    if (s.kind === 'comune') return this.census.comuni().get(s.code)?.prov ?? null;
    return null;
  });

  /** Vista da lontano: cambia solo al passaggio della soglia, non a ogni livello di zoom. */
  private farView = computed(() => this.zoom() < 8);

  private selectedComune = computed(() => {
    const s = this.sel.selected();
    return s.kind === 'comune' ? s.code : null;
  });

  /** Regioni di cui disegnare i confini comunali. */
  private comuniRegions = computed<number[]>(() => {
    if (!this.mapSvc.showComuni()) return [];
    if (this.choro.level() === 'comune') return ALL_REGIONS;
    const reg = this.highlightRegion();
    const kind = this.sel.selected().kind;
    return reg !== null && (this.zoom() >= COMUNE_ZOOM - 1 || kind === 'comune' || kind === 'province') ? [reg] : [];
  });

  private provinceFeature(code: number) {
    return this.geo.provinces.hasValue() ? this.geo.provinces.value().features.find(f => f.properties.prov_istat_code_num === code) : undefined;
  }

  protected selectedRegionName = computed(() => {
    const code = this.highlightRegion();
    return this.geo.regions.hasValue()
      ? (this.geo.regions.value().features.find(f => f.properties.reg_istat_code_num === code)?.properties.reg_name ?? null)
      : null;
  });

  constructor() {
    afterNextRender(() => this.init());

    inject(DestroyRef).onDestroy(() => {
      this.mapSvc.map.set(undefined);
      this.map?.remove();
    });

    // confini delle regioni, una sola volta quando arrivano; visibili a scelta
    effect(() => {
      if (!this.ready() || !this.geo.regions.hasValue()) return;
      const features = this.geo.regions.value().features;
      if (!this.regionsLayer) untracked(() => this.drawRegions(features));
      const show = this.mapSvc.showBorders();
      if (show && !this.map!.hasLayer(this.regionsLayer!)) this.regionsLayer!.addTo(this.map!);
      if (!show) this.regionsLayer!.remove();
      // i path SVG esistono solo ora: si chiede di ridipingerli
      untracked(() => this.regionsVersion.update(v => v + 1));
    });

    // regione evidenziata e coropleta: le dipendenze si leggono prima di qualunque uscita anticipata,
    // altrimenti l'effetto non si riattiva quando arrivano i dati
    effect(() => {
      this.highlightRegion();
      this.choro.regionFills();
      this.regionsVersion();
      if (!this.ready() || !this.regionsLayer) return;
      untracked(() => this.paintRegions());
    });

    // province della regione evidenziata
    effect(() => {
      if (!this.ready()) return;
      const code = this.highlightRegion();
      const selected = this.highlightProvince();
      // con i comuni visibili le province sono solo linee: il puntatore deve arrivare ai comuni sotto
      const interactive = code === null || !this.comuniRegions().includes(code);
      this.provincesLayer.clearLayers();
      if (code !== null && this.mapSvc.showProvinces() && this.geo.provinces.hasValue()) {
        this.drawProvinces(this.geo.provincesOf(code), selected, interactive);
      }
    });

    // ---------- confini comunali (canvas, una regione alla volta) ----------
    effect(() => {
      for (const reg of this.comuniRegions()) this.census.ensureGeo(reg);
    });

    // crea i layer per le regioni arrivate e mostra solo quelle richieste
    effect(() => {
      if (!this.ready()) return;
      const loaded = this.census.loadedGeo();
      const want = new Set(this.comuniRegions());
      untracked(() => {
        let created = false;
        for (const reg of want) {
          const fc = loaded.get(reg);
          if (fc && !this.comuniLayers.has(reg)) {
            this.comuniLayers.set(reg, this.buildComuni(fc));
            created = true;
          }
        }
        for (const [reg, layer] of this.comuniLayers) {
          const show = want.has(reg);
          if (show && !this.map!.hasLayer(layer)) layer.addTo(this.map!);
          if (!show && this.map!.hasLayer(layer)) layer.remove();
        }
        if (created) this.comuniVersion.update(v => v + 1);
      });
    });

    // colori dei comuni: coropleta, comune selezionato, tema
    effect(() => {
      this.comuniVersion();
      const fills = this.choro.comuneFills();
      const sel = this.selectedComune();
      const theme = this.theme.theme();
      const far = this.farView();
      untracked(() => {
        const accent = cssVar('--accent');
        const line = theme === 'dark' ? 'rgba(214,222,232,0.28)' : 'rgba(17,26,36,0.3)';
        for (const layer of this.comuniLayers.values()) {
          layer.eachLayer(l => {
            const k = (l as L.GeoJSON & { feature: Feature<ComuneProps> }).feature.properties.k;
            (l as L.Path).setStyle(comuneStyle(fills.get(k), k === sel, accent, line, far ? 5 : 9));
          });
        }
        if (sel) this.bringComuneToFront(sel);
      });
    });

    // ---------- coropleta delle province (tempo reale) ----------
    effect(() => {
      if (!this.ready() || !this.geo.provinces.hasValue()) return;
      const on = this.choro.level() === 'province';
      const fills = this.choro.provinceFills();
      const features = this.geo.provinces.value().features;
      untracked(() => {
        if (on && !this.provChoro) this.provChoro = this.buildProvChoro(features);
        if (!this.provChoro) return;
        if (on && !this.map!.hasLayer(this.provChoro)) this.provChoro.addTo(this.map!);
        if (!on) this.provChoro.remove();
        this.provChoro.eachLayer(l => {
          const code = (l as L.GeoJSON & { feature: Feature<ProvinceProps> }).feature.properties.prov_istat_code_num;
          const fill = fills.get(code);
          (l as L.Path).setStyle({ fillColor: fill ?? '#000', fillOpacity: fill ? 0.6 : 0 });
        });
      });
    });

    // ---------- zone d'allerta della Protezione Civile ----------
    effect(() => {
      if (this.mapSvc.showAlerts()) this.alerts.load();
    });

    effect(() => {
      if (!this.ready()) return;
      const show = this.mapSvc.showAlerts();
      const zones = this.alerts.zones()[this.mapSvc.alertDay()];
      untracked(() => {
        this.alertLayer?.remove();
        this.alertLayer = undefined;
        if (!show || !zones.length) return;
        this.alertLayer = L.geoJSON(
          zones.filter(z => z.geometry).map(z => ({ type: 'Feature', properties: z, geometry: z.geometry })) as any,
          {
            renderer: this.alertCanvas,
            pane: 'alerts',
            style: (f: any) => ({
              color: ALERT_COLOR[f.properties.level as AlertLevel],
              weight: f.properties.level ? 1.2 : 0.4,
              opacity: 0.8,
              fillColor: ALERT_COLOR[f.properties.level as AlertLevel],
              fillOpacity: f.properties.level ? 0.35 : 0.04,
            }),
            onEachFeature: (f: any, layer: L.Layer) => layer.bindTooltip(() => alertTip(f.properties), { sticky: true, className: 'geo-tip' }),
          } as CanvasGeoJSONOptions<AlertZone>,
        ).addTo(this.map!);
      });
    });

    // segnaposto della località
    effect(() => {
      if (!this.ready()) return;
      const { lat, lon } = this.loc.coords();
      const isPlace = this.sel.selected().kind === 'place';
      if (!this.pin) {
        this.pin = L.marker([lat, lon], {
          icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [22, 22] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(this.map!);
      } else this.pin.setLatLng([lat, lon]);
      this.pin.getElement()?.classList.toggle('dim', !isPlace);
    });

    // meteo dei capoluoghi: le città più grandi hanno la precedenza, le pillole non si sovrappongono
    effect(() => {
      if (!this.ready()) return;
      this.weatherLayer.clearLayers();
      if (!this.mapSvc.showWeather()) return;
      const compact = this.zoom() < 6;
      const [bw, bh] = compact ? [56, 26] : [118, 26]; // ingombro stimato della pillola
      const placed: L.Point[] = [];
      const items = this.capitals
        .list()
        .filter(x => x.now && Number.isFinite(x.now.temp))
        .sort((a, b) => PRIORITY.indexOf(a.region.code) - PRIORITY.indexOf(b.region.code));
      for (const { region, now } of items) {
        const pt = this.map!.latLngToContainerPoint([region.capital.lat, region.capital.lon]);
        if (placed.some(o => Math.abs(o.x - pt.x) < bw && Math.abs(o.y - pt.y) < bh)) continue;
        placed.push(pt);
        this.weatherLayer.addLayer(this.weatherMarker(region, now!.temp, now!.code, compact));
      }
    });

    // marker dei terremoti: ricreati solo quando cambia l'elenco
    effect(() => {
      if (!this.ready()) return;
      const list = this.quakes.list();
      untracked(() => {
        this.quakeLayer.clearLayers();
        this.quakeMarkers.clear();
        this.lastHot = null;
        // i più forti sopra: si aggiungono per ultimi
        for (const q of [...list].sort((a, b) => a.mag - b.mag)) {
          const m = L.circleMarker([q.lat, q.lon], { ...quakeStyle(q, false), bubblingMouseEvents: false, className: 'qk' })
            .bindTooltip(() => quakeTip(q), { direction: 'top', className: 'geo-tip', offset: [0, -6] })
            .on('mouseover', () => this.sel.hoveredQuake.set(q.id))
            .on('mouseout', () => this.sel.hoveredQuake.set(null))
            .on('click', () => this.sel.selectQuake(q.id));
          this.quakeMarkers.set(q.id, { m, q });
        }
        this.markersVersion.update(v => v + 1);
      });
    });

    // visibilità: layer acceso e finestra della timeline (veloce anche durante il replay)
    effect(() => {
      this.markersVersion();
      if (!this.ready()) return;
      const show = this.mapSvc.showQuakes();
      const visible = new Set(this.quakes.visible().map(q => q.id));
      for (const [id, { m }] of this.quakeMarkers) {
        const want = show && visible.has(id);
        const has = this.quakeLayer.hasLayer(m);
        if (want && !has) this.quakeLayer.addLayer(m);
        else if (!want && has) this.quakeLayer.removeLayer(m);
      }
    });

    // evento sotto il puntatore (da mappa, elenchi, feed o timeline)
    effect(() => {
      this.markersVersion();
      const id = this.sel.hoveredQuake();
      untracked(() => {
        if (this.lastHot && this.lastHot !== id) {
          const prev = this.quakeMarkers.get(this.lastHot);
          prev?.m.setStyle(quakeStyle(prev.q, false)).closeTooltip();
        }
        const cur = id ? this.quakeMarkers.get(id) : undefined;
        if (cur) {
          cur.m.setStyle(quakeStyle(cur.q, true)).bringToFront();
          if (this.quakeLayer.hasLayer(cur.m)) cur.m.openTooltip();
        }
        this.lastHot = id;
      });
    });

    // anello sull'evento selezionato
    effect(() => {
      this.markersVersion();
      if (!this.ready()) return;
      const s = this.sel.selected();
      this.selRing?.remove();
      this.selRing = undefined;
      if (s.kind !== 'quake') return;
      const q = this.quakes.byId().get(s.id);
      if (!q) return;
      this.selRing = L.circleMarker([q.lat, q.lon], {
        radius: Math.max(3, 2 + q.mag * 2.2) + 8,
        className: 'sel-ring',
        interactive: false,
      }).addTo(this.map!);
    });

    // cerchio del filtro "vicino a"
    effect(() => {
      if (!this.ready()) return;
      const near = this.quakes.query().near;
      this.radius?.remove();
      this.radius = undefined;
      if (near && this.mapSvc.showQuakes()) {
        this.radius = L.circle([near.lat, near.lon], { radius: near.radiusKm * 1000, className: 'radius', interactive: false }).addTo(this.map!);
      }
    });
  }

  private init() {
    const map = L.map(this.el().nativeElement, { zoomControl: false, minZoom: 3, worldCopyJump: true });
    const v = this.mapSvc.initialView;
    if (v) map.setView([v.lat, v.lon], v.z);
    else map.fitBounds(ITALY_BOUNDS);
    // senza vista dall'URL l'Italia si inquadra appena il contenitore ha una dimensione e i pannelli sono
    // al loro posto (all'avvio può essere ancora 0×0), a meno che l'utente nel frattempo non muova la mappa
    let pendingFit = !v;
    map.on('dragstart zoomstart', () => (pendingFit = false));

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · confini © <a href="https://www.istat.it/">ISTAT</a> CC BY',
    }).addTo(map);

    // ordine dei layer: allerte e coropleta province sotto, poi confini regionali, comuni, province, meteo, terremoti
    map.createPane('alerts').style.zIndex = '330';
    map.createPane('provchoro').style.zIndex = '340';
    map.createPane('regions').style.zIndex = '350';
    map.createPane('comuni').style.zIndex = '355';
    map.createPane('provinces').style.zIndex = '360';
    this.alertCanvas = L.canvas({ pane: 'alerts', padding: 0.3 });
    this.comuniCanvas = L.canvas({ pane: 'comuni', padding: 0.3, tolerance: 1 });
    this.provCanvas = L.canvas({ pane: 'provchoro', padding: 0.3 });
    this.provincesLayer.addTo(map);
    this.weatherLayer.addTo(map);
    this.quakeLayer.addTo(map);

    map.on('click', e => this.onClick(e.latlng));
    const syncView = () => {
      const c = map.getCenter();
      this.zoom.set(map.getZoom());
      this.mapSvc.zoom.set(map.getZoom());
      this.mapSvc.center.set({ lat: Math.round(c.lat * 1e4) / 1e4, lon: Math.round(L.Util.wrapNum(c.lng, [-180, 180], true) * 1e4) / 1e4 });
    };
    map.on('moveend', syncView);
    syncView();

    // coordinate del cursore nell'HUD, al massimo una volta per frame
    let frame = 0;
    map.on('mousemove', e => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.cursor.set({ lat: e.latlng.lat, lon: L.Util.wrapNum(e.latlng.lng, [-180, 180], true) }));
    });
    map.on('mouseout', () => this.cursor.set(null));

    // il contenitore cambia dimensione con il layout: Leaflet va avvisato
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      const { clientWidth, clientHeight } = this.el().nativeElement;
      if (pendingFit && clientWidth > 0 && clientHeight > 0) {
        pendingFit = false;
        this.mapSvc.fitItaly(false);
      }
    });
    ro.observe(this.el().nativeElement);
    map.on('unload', () => ro.disconnect());

    this.map = map;
    this.mapSvc.map.set(map);
    this.ready.set(true);
  }

  /**
   * Il clic sceglie il livello in base allo zoom: regione (vista d'insieme), provincia, comune.
   * Fuori dall'Italia o in mare resta il punto come località.
   */
  private onClick({ lat, lng }: L.LatLng) {
    const lon = L.Util.wrapNum(lng, [-180, 180], true);
    const z = this.map!.getZoom();
    const reg = this.geo.regionAt(lat, lon);
    if (reg && z < DRILL_ZOOM) {
      this.actions.focusRegion(reg.properties.reg_istat_code_num);
      return;
    }
    const prov = this.geo.provinceAt(lat, lon);
    if (prov && z < COMUNE_ZOOM) {
      this.actions.focusProvince(prov.properties.prov_istat_code_num);
      return;
    }
    this.actions.focusPoint(lat, lon);
  }

  /** Confini comunali di una regione su canvas, con nome e abitanti al passaggio. */
  private buildComuni(fc: FeatureCollection<ComuneProps>): L.GeoJSON {
    const options: CanvasGeoJSONOptions<ComuneProps> = {
      renderer: this.comuniCanvas,
      pane: 'comuni',
      style: () => comuneStyle(undefined, false, cssVar('--accent'), 'rgba(214,222,232,0.28)'),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(() => this.comuneTip(f.properties), { sticky: true, className: 'geo-tip', offset: [0, -8] });
        layer.on('mouseover', () => (layer as L.Path).setStyle({ weight: 2 }));
        layer.on('mouseout', () => (layer as L.Path).setStyle({ weight: f.properties.k === this.selectedComune() ? 2.5 : 0.6 }));
      },
    };
    return L.geoJSON<ComuneProps>(fc as any, options);
  }

  private comuneTip(p: ComuneProps): HTMLElement {
    const c = this.census.comuni().get(p.k);
    const el = document.createElement('div');
    el.className = 'qtip';
    const t = document.createElement('strong');
    t.textContent = `${p.n} (${p.s})`;
    el.append(t);
    if (c?.pop) {
      const s = document.createElement('span');
      const metric = this.choro.mode().startsWith('c:') ? this.metricText(c) : '';
      s.textContent = `${c.pop.toLocaleString('it-IT')} ab · ${c.area.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km²${metric}`;
      el.append(s);
    }
    return el;
  }

  /** Valore della coropleta comunale attiva per il tooltip. */
  private metricText(c: Comune): string {
    const mode = this.choro.mode();
    if (mode === 'c:alert' || mode === 'c:alert2') {
      const z = this.alerts.zoneOf(c, mode === 'c:alert' ? 'today' : 'tomorrow');
      return z ? ` · ${ALERT_LABEL[z.level]}` : '';
    }
    const m = metricById(mode.slice(2));
    const v = m?.value(c);
    return m && v !== null && v !== undefined ? ` · ${m.label}: ${v.toLocaleString('it-IT', { maximumFractionDigits: m.digits })} ${m.unit}` : '';
  }

  private bringComuneToFront(k: string) {
    for (const layer of this.comuniLayers.values()) {
      layer.eachLayer(l => {
        if ((l as L.GeoJSON & { feature: Feature<ComuneProps> }).feature.properties.k === k) (l as L.Path).bringToFront();
      });
    }
  }

  /** Province di tutta Italia su canvas, per la coropleta in tempo reale. */
  private buildProvChoro(features: Feature<ProvinceProps>[]): L.GeoJSON {
    const options: CanvasGeoJSONOptions<ProvinceProps> = {
      renderer: this.provCanvas,
      pane: 'provchoro',
      style: () => ({ color: 'rgba(214,222,232,0.35)', weight: 0.6, fillOpacity: 0 }),
      onEachFeature: (f, layer) =>
        layer.bindTooltip(
          () => {
            const v = this.choro.provinceValues().get(f.properties.prov_istat_code_num);
            const unit = this.choro.mode() === 'p:aqi' ? ' EAQI' : '°';
            return `${f.properties.prov_name} (${f.properties.prov_acr})${v === null || v === undefined ? '' : ` · ${Math.round(v)}${unit}`}`;
          },
          { sticky: true, className: 'geo-tip' },
        ),
    };
    return L.geoJSON<ProvinceProps>(features as any, options);
  }

  private drawRegions(features: Feature<RegionProps>[]) {
    this.regionsLayer = L.geoJSON<RegionProps>(features as any, {
      pane: 'regions',
      style: () => ({ className: 'geo-region', weight: 1.2, fill: true, fillOpacity: 0 }),
      onEachFeature: (f, layer) => {
        const path = layer as L.Path;
        this.regionLayers.set(f.properties.reg_istat_code_num, path);
        path.bindTooltip(f.properties.reg_name, { sticky: true, direction: 'top', className: 'geo-tip', offset: [0, -8] });
      },
    });
  }

  /** Evidenziazione e colori della coropleta (stile in linea: vince sul CSS dei confini). */
  private paintRegions() {
    const code = this.highlightRegion();
    const fills = this.choro.regionFills();
    for (const [c, layer] of this.regionLayers) {
      const el = layer.getElement() as SVGElement | undefined;
      if (!el) continue;
      el.classList.toggle('is-selected', c === code);
      const fill = fills.get(c);
      el.classList.toggle('choro', !!fill);
      el.style.fill = fill ?? '';
    }
  }

  private drawProvinces(list: Feature<ProvinceProps>[], selected: number | null, interactive: boolean) {
    L.geoJSON<ProvinceProps>(list as any, {
      pane: 'provinces',
      interactive,
      style: f => ({
        className: f?.properties.prov_istat_code_num === selected ? 'geo-prov is-selected' : 'geo-prov',
        weight: 0.8,
        fill: interactive,
        fillOpacity: 0,
      }),
      onEachFeature: (f, layer) => {
        if (!interactive) return;
        layer.bindTooltip(`${f.properties.prov_name} (${f.properties.prov_acr})`, {
          sticky: true,
          direction: 'top',
          className: 'geo-tip',
          offset: [0, -8],
        });
      },
    }).addTo(this.provincesLayer);
  }

  private weatherMarker(region: Region, temp: number, code: number, compact: boolean): L.Marker {
    const cap = region.capital;
    // contenuto solo da dati statici e numeri: niente testo esterno nell'HTML
    const label = compact ? '' : `<span class="wx-n">${cap.name}</span>`;
    const html = `<div class="wx-b"><span class="wx-i">${weatherIcon(code)}</span><b>${Math.round(temp)}°</b>${label}</div>`;
    const m = L.marker([cap.lat, cap.lon], {
      // contenitore di dimensione zero sul punto; la pillola è centrata via CSS
      icon: L.divIcon({ className: 'wx', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      title: `${cap.name}: ${weatherLabel(code)}, ${Math.round(temp)}°`,
      riseOnHover: true,
    });
    m.on('click', () => this.actions.goCapital(region));
    return m;
  }
}
