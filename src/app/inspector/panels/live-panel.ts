import { Component, DestroyRef, computed, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { rxResource } from '@angular/core/rxjs-interop';
import { ALERT_COLOR, ALERT_LABEL, AlertLevel } from '../../core/alerts';
import { AlertsService } from '../../core/alerts.service';
import { km } from '../../core/analysis';
import { ApisService } from '../../core/apis.service';
import { Comune } from '../../core/census';
import { ago, depthColor } from '../../core/format';
import { aqiBand } from '../../core/parsers';
import { weatherIcon, weatherLabel } from '../../core/weather';
import { Bar, BarChart } from '../../shared/bar-chart';

/** Ogni quanto si ricaricano i dati in tempo reale mentre il pannello è aperto. */
const REFRESH_MS = 10 * 60_000;
/** Oltre questa distanza la "cella di mare" del modello non descrive il luogo. */
const SEA_MAX_KM = 30;

/**
 * Situazione in tempo reale attorno a un punto: meteo, aria, allerte DPC, sismicità recente, mare, sole.
 * Per un comune l'allerta è quella della sua zona; per un territorio (`group`) si contano i comuni per livello.
 */
@Component({
  selector: 'app-live-panel',
  imports: [DatePipe, DecimalPipe, BarChart],
  template: `
    <div class="tiles">
      <!-- meteo -->
      <div class="tile">
        <span class="label">Meteo</span>
        @if (weather.hasValue()) {
          @let c = weather.value().current;
          <div class="big"><span class="ico">{{ icon(c.weather_code) }}</span> <b class="mono">{{ c.temperature_2m | number: '1.0-0' }}°</b></div>
          <span class="sub">{{ label(c.weather_code) }} · {{ c.wind_speed_10m | number: '1.0-0' }} km/h · {{ c.relative_humidity_2m }}%</span>
        } @else if (weather.error()) {
          <span class="sub">non disponibile</span>
        } @else {
          <div class="skeleton" style="height: 38px"></div>
        }
      </div>

      <!-- aria -->
      <div class="tile">
        <span class="label">Qualità dell'aria</span>
        @if (air.hasValue()) {
          @let a = air.value();
          @let band = aqi(a.aqi);
          <div class="big">
            <i class="dot" [style.background]="band?.color ?? 'var(--faint)'"></i>
            <b class="mono">{{ a.aqi ?? '—' }}</b> <small>EAQI</small>
          </div>
          <span class="sub">{{ band?.label ?? 'n.d.' }} · PM2,5 {{ a.pm2_5 | number: '1.0-0' }} µg/m³</span>
        } @else if (air.error()) {
          <span class="sub">non disponibile</span>
        } @else {
          <div class="skeleton" style="height: 38px"></div>
        }
      </div>

      <!-- allerta -->
      <div class="tile">
        <span class="label">Allerta meteo-idro · DPC</span>
        @if (alerts.loading()) {
          <div class="skeleton" style="height: 38px"></div>
        } @else if (alerts.error()) {
          <span class="sub">bollettino non disponibile</span>
        } @else if (comune(); as c) {
          @for (d of days; track d.key) {
            @let z = alerts.zoneOf(c, d.key);
            <div class="alert-row">
              <span class="mono day">{{ d.label }}</span>
              <i class="lvl" [style.background]="color(z?.level ?? 0)"></i>
              <span>{{ alertLabel(z?.level ?? 0) }}</span>
            </div>
          }
          @if (alerts.zoneOf(c, 'today'); as z) {
            <span class="sub">zona {{ z.name }}</span>
          }
        } @else {
          @for (d of days; track d.key) {
            @let n = counts()[d.key];
            <div class="alert-row">
              <span class="mono day">{{ d.label }}</span>
              @for (lvl of [3, 2, 1]; track lvl) {
                @if (n[lvl]) {
                  <span class="pill mono" [style.background]="color(lvl)">{{ n[lvl] }}</span>
                }
              }
              @if (!n[1] && !n[2] && !n[3]) {
                <span class="sub">nessuna allerta</span>
              }
            </div>
          }
          <span class="sub">comuni per livello</span>
        }
      </div>

      <!-- sismicità -->
      <div class="tile">
        <span class="label">Sismicità · {{ radiusKm() }} km · 7 g</span>
        @if (quakes.hasValue()) {
          @let s = quakeStats();
          <div class="big"><b class="mono">{{ s.count }}</b> <small>eventi M1+</small></div>
          <span class="sub">
            @if (s.max; as m) {
              max M{{ m.mag | number: '1.1-1' }} · ultimo {{ s.lastAgo }}
            } @else {
              nessun evento
            }
          </span>
        } @else if (quakes.error()) {
          <span class="sub">INGV non disponibile</span>
        } @else {
          <div class="skeleton" style="height: 38px"></div>
        }
      </div>

      <!-- sole -->
      @if (weather.hasValue() && weather.value().daily.sunrise[0]) {
        @let d = weather.value().daily;
        <div class="tile">
          <span class="label">Sole · UV</span>
          <div class="big mono"><small>↑</small>{{ d.sunrise[0].slice(11) }} <small>↓</small>{{ d.sunset[0].slice(11) }}</div>
          <span class="sub">indice UV max {{ d.uv_index_max[0] | number: '1.0-1' }} · {{ uvLabel(d.uv_index_max[0]) }}</span>
        </div>
      }

      <!-- mare -->
      @if (sea(); as m) {
        <div class="tile">
          <span class="label">Mare · {{ m.distKm | number: '1.0-0' }} km</span>
          <div class="big"><b class="mono">{{ m.wave | number: '1.1-1' }}</b> <small>m onda</small></div>
          <span class="sub">acqua {{ m.sst | number: '1.0-1' }}° · periodo {{ m.period | number: '1.0-0' }} s</span>
        </div>
      }
    </div>

    @if (air.hasValue()) {
      @let a = air.value();
      <div class="detail">
        <span class="label">Inquinanti (µg/m³) e pollini</span>
        <div class="chips mono">
          <span>PM10 <b>{{ a.pm10 | number: '1.0-0' }}</b></span>
          <span>PM2,5 <b>{{ a.pm2_5 | number: '1.0-0' }}</b></span>
          <span>NO₂ <b>{{ a.no2 | number: '1.0-0' }}</b></span>
          <span>O₃ <b>{{ a.o3 | number: '1.0-0' }}</b></span>
          <span>SO₂ <b>{{ a.so2 | number: '1.0-0' }}</b></span>
          @for (p of a.pollen; track p.name) {
            <span class="pollen">{{ p.name }} <b>{{ p.value | number: '1.0-0' }}</b></span>
          }
        </div>
        @if (aqiBars().length) {
          <span class="label">EAQI · 24 h passate e prossime 24 h</span>
          <app-bar-chart [bars]="aqiBars()" [height]="110" [maxLabels]="8" ariaLabel="Indice di qualità dell'aria nelle 48 ore" />
        }
      </div>
    }

    @if (recent().length) {
      <div class="detail">
        <span class="label">Ultimi eventi vicini</span>
        <ul class="rel">
          @for (q of recent(); track q.id) {
            <li class="mono">
              <span [style.color]="qcolor(q.depthKm)">M{{ q.mag | number: '1.1-1' }}</span>
              <span class="txt">{{ q.place }}</span>
              <span class="muted">{{ q.time | date: 'dd/MM HH:mm' }}</span>
            </li>
          }
        </ul>
      </div>
    }

    <p class="fresh mono">
      Dati in tempo reale · aggiornamento automatico ogni 10 min
      @if (alerts.title(); as t) {
        · {{ t }}
      }
    </p>
  `,
  styleUrl: './panels.css',
})
export class LivePanel {
  readonly lat = input.required<number>();
  readonly lon = input.required<number>();
  /** comune: allerta della sua zona */
  readonly comune = input<Comune | null>(null);
  /** territorio: conteggio dei comuni per livello d'allerta */
  readonly group = input<Comune[]>([]);
  readonly radiusKm = input(30);

  private api = inject(ApisService);
  protected alerts = inject(AlertsService);
  protected readonly icon = weatherIcon;
  protected readonly label = weatherLabel;
  protected readonly aqi = aqiBand;
  protected readonly qcolor = depthColor;
  protected readonly days = [
    { key: 'today' as const, label: 'OGGI' },
    { key: 'tomorrow' as const, label: 'DOMANI' },
  ];

  private point = computed(() => ({ lat: this.lat(), lon: this.lon() }), {
    equal: (a, b) => a.lat === b.lat && a.lon === b.lon,
  });

  protected weather = rxResource({ params: () => this.point(), stream: ({ params: p }) => this.api.forecast(p.lat, p.lon) });
  protected air = rxResource({ params: () => this.point(), stream: ({ params: p }) => this.api.airQuality(p.lat, p.lon) });
  protected marine = rxResource({ params: () => this.point(), stream: ({ params: p }) => this.api.marine(p.lat, p.lon) });
  protected quakes = rxResource({
    params: () => ({ ...this.point(), r: this.radiusKm() }),
    stream: ({ params: p }) => this.api.quakes({ source: 'ingv', days: 7, minMag: 1, near: { lat: p.lat, lon: p.lon, radiusKm: p.r } }),
  });

  constructor() {
    this.alerts.load();
    const id = setInterval(() => {
      this.weather.reload();
      this.air.reload();
      this.marine.reload();
      this.quakes.reload();
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  protected counts = computed(() => ({
    today: this.alerts.countLevels(this.group(), 'today'),
    tomorrow: this.alerts.countLevels(this.group(), 'tomorrow'),
  }));

  protected sea = computed(() => {
    const m = this.marine.hasValue() ? this.marine.value() : null;
    if (!m) return null;
    const distKm = km(this.point(), { lat: m.lat, lon: m.lon });
    return distKm <= SEA_MAX_KM ? { ...m, distKm } : null;
  });

  protected quakeStats = computed(() => {
    const list = this.quakes.hasValue() ? this.quakes.value() : [];
    const max = list.reduce<(typeof list)[number] | null>((m, q) => (!m || q.mag > m.mag ? q : m), null);
    const last = list.reduce((t, q) => Math.max(t, q.time), 0);
    return { count: list.length, max, lastAgo: last ? ago(last) : '—' };
  });

  protected recent = computed(() => (this.quakes.hasValue() ? [...this.quakes.value()].sort((a, b) => b.time - a.time).slice(0, 5) : []));

  /** Barre dell'EAQI orario, colorate per fascia; la barra dell'ora corrente è segnata. */
  protected aqiBars = computed<Bar[]>(() => {
    if (!this.air.hasValue()) return [];
    const nowH = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 13).replace(' ', 'T');
    return this.air
      .value()
      .hourly.filter(h => h.aqi !== null)
      .map(h => ({
        label: h.time.slice(11, 13) === '00' ? h.time.slice(8, 10) + '/' + h.time.slice(5, 7) : h.time.slice(11, 16),
        value: h.aqi!,
        color: h.time.startsWith(nowH) ? 'var(--text)' : (aqiBand(h.aqi)?.color ?? 'var(--accent)'),
      }));
  });

  protected color(l: number) {
    return ALERT_COLOR[l as AlertLevel];
  }

  protected alertLabel(l: number) {
    return ALERT_LABEL[l as AlertLevel];
  }

  protected uvLabel(v: number) {
    return v < 3 ? 'basso' : v < 6 ? 'moderato' : v < 8 ? 'alto' : v < 11 ? 'molto alto' : 'estremo';
  }
}
