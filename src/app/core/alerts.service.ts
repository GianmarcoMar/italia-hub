import { Injectable, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable, of, tap } from 'rxjs';
import { AlertLevel, AlertZone, bulletinText, indexZones, zoneFor } from './alerts';
import { ApisService } from './apis.service';
import { Comune } from './census';

export type AlertDay = 'today' | 'tomorrow';

const ID_KEY = 'italia-hub:dpc-id';
/** L'id dell'ultimo bollettino si richiede a GitHub al massimo ogni 20 minuti (limite 60/ora per IP). */
const ID_TTL = 20 * 60_000;

/**
 * Allerte meteo-idro della Protezione Civile per oggi e domani: zone d'allerta (layer della mappa)
 * e livello per comune. Si carica alla prima richiesta.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private api = inject(ApisService);
  private wanted = signal(false);

  load() {
    this.wanted.set(true);
  }

  readonly id = rxResource({
    params: () => (this.wanted() ? true : undefined),
    stream: () => this.cachedId(),
  });

  readonly bulletin = rxResource({
    params: () => (this.id.hasValue() ? (this.id.value() ?? undefined) : undefined),
    stream: ({ params: id }) => this.api.dpcBulletin(id),
  });

  readonly today = rxResource({
    params: () => (this.bulletin.hasValue() ? this.bulletin.value().today.topo_json : undefined),
    stream: ({ params: url }) => this.api.dpcZones(url),
  });

  readonly tomorrow = rxResource({
    params: () => (this.bulletin.hasValue() ? this.bulletin.value().tomorrow.topo_json : undefined),
    stream: ({ params: url }) => this.api.dpcZones(url),
  });

  readonly title = computed(() => (this.bulletin.hasValue() ? this.bulletin.value().name : null));
  readonly loading = computed(() => this.id.isLoading() || this.bulletin.isLoading() || this.today.isLoading());
  readonly error = computed(() => !!(this.id.error() || this.bulletin.error() || this.today.error()));

  readonly zones = computed(() => ({
    today: this.today.hasValue() ? this.today.value() : [],
    tomorrow: this.tomorrow.hasValue() ? this.tomorrow.value() : [],
  }));

  private idx = computed(() => ({ today: indexZones(this.zones().today), tomorrow: indexZones(this.zones().tomorrow) }));

  /** Descrizioni testuali del bollettino, riga per riga. */
  readonly text = computed(() =>
    this.bulletin.hasValue()
      ? { today: bulletinText(this.bulletin.value().today.html_descrition), tomorrow: bulletinText(this.bulletin.value().tomorrow.html_descrition) }
      : null,
  );

  /** Zona d'allerta di un comune per il giorno indicato. */
  zoneOf(c: Pick<Comune, 'name' | 'x' | 'y'>, day: AlertDay): AlertZone | null {
    return zoneFor(this.idx()[day], c.name, c.y, c.x);
  }

  /** Quanti comuni del gruppo per livello d'allerta (per province, regioni, Italia). */
  countLevels(list: Comune[], day: AlertDay): [number, number, number, number] {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    if (!this.zones()[day].length) return out;
    for (const c of list) out[(this.zoneOf(c, day)?.level ?? 0) as AlertLevel]++;
    return out;
  }

  private cachedId(): Observable<string | null> {
    try {
      const raw = sessionStorage.getItem(ID_KEY);
      const c = raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
      if (c && Date.now() - c.at < ID_TTL && /^\d{8}_\d{4}$/.test(c.id)) return of(c.id);
    } catch {
      /* storage non disponibile */
    }
    return this.api.dpcLatestId().pipe(
      tap(id => {
        try {
          if (id) sessionStorage.setItem(ID_KEY, JSON.stringify({ id, at: Date.now() }));
        } catch {
          /* pazienza */
        }
      }),
    );
  }
}
