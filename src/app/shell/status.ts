import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ago } from '../core/format';
import { GeoService } from '../core/geo.service';
import { CapitalsWeatherStore, ForecastStore, QuakeStore } from '../core/stores';

type Health = 'ok' | 'busy' | 'err' | 'idle';

function health(status: string): Health {
  if (status === 'error') return 'err';
  if (status === 'loading' || status === 'reloading') return 'busy';
  if (status === 'resolved' || status === 'local') return 'ok';
  return 'idle';
}

/** Spie dello stato delle fonti e orologio UTC/Roma, nella barra in alto. */
@Component({
  selector: 'app-status',
  imports: [DatePipe],
  template: `
    <ul class="lights" aria-label="Stato delle fonti">
      @for (s of sources(); track s.name) {
        <li [title]="s.name + ': ' + s.text">
          <i [class]="s.health"></i><span>{{ s.short }}</span>
        </li>
      }
    </ul>
    <div class="clock mono" aria-label="Ora">
      <span><b>UTC</b> {{ now() | date: 'HH:mm:ss' : 'UTC' }}</span>
      <span><b>ROMA</b> {{ rome() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .lights {
      display: flex;
      gap: 10px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      align-items: center;
      gap: 5px;
      font-family: var(--mono);
      font-size: 0.68rem;
      letter-spacing: 0.06em;
      color: var(--muted);
      cursor: default;
    }
    i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--faint);
    }
    i.ok {
      background: var(--ok);
      box-shadow: 0 0 6px var(--ok);
    }
    i.busy {
      background: var(--warn);
      animation: blink 0.9s ease-in-out infinite alternate;
    }
    i.err {
      background: var(--danger);
      box-shadow: 0 0 6px var(--danger);
    }
    .clock {
      display: flex;
      gap: 12px;
      font-size: 0.78rem;
      color: var(--text);
      white-space: nowrap;
    }
    .clock b {
      color: var(--muted);
      font-weight: 500;
      font-size: 0.68rem;
      letter-spacing: 0.06em;
    }
    @keyframes blink {
      to {
        opacity: 0.3;
      }
    }
    @media (max-width: 1100px) {
      .lights span {
        display: none;
      }
    }
    @media (max-width: 860px) {
      .clock span:last-child {
        display: none;
      }
    }
  `,
})
export class StatusBar {
  private forecast = inject(ForecastStore);
  private capitals = inject(CapitalsWeatherStore);
  private quakes = inject(QuakeStore);
  private geo = inject(GeoService);

  protected now = signal(Date.now());

  // DatePipe accetta solo offset fissi, non fusi come Europe/Rome (che cambia con l'ora legale)
  private romeFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  protected rome = computed(() => this.romeFmt.format(this.now()));

  constructor() {
    const id = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  protected sources = computed(() => {
    this.now(); // aggiorna i "x minuti fa"
    const row = (name: string, short: string, status: string, at: number | null) => {
      const h = health(status);
      const text = h === 'err' ? 'errore' : h === 'busy' ? 'aggiornamento…' : at ? `aggiornato ${ago(at)}` : 'in attesa';
      return { name, short, health: h, text };
    };
    return [
      row('Sismica (INGV/USGS)', 'SISMA', this.quakes.quakes.status(), this.quakes.updatedAt()),
      row('Meteo località (Open-Meteo)', 'METEO', this.forecast.forecast.status(), this.forecast.updatedAt()),
      row('Meteo capoluoghi (Open-Meteo)', 'CAPOL', this.capitals.weather.status(), this.capitals.updatedAt()),
      row('Confini ISTAT', 'GEO', this.geo.regions.status(), null),
    ];
  });
}
