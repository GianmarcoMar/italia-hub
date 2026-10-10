import {
  QUAKE_STEPS,
  TEMP_STEPS,
  binEvents,
  binSize,
  countByRegion,
  inWindow,
  km,
  parseView,
  relatedQuakes,
  serializeView,
  stepColor,
  weatherAlert,
} from './analysis';
import { Quake } from './parsers';

const H = 3_600_000;
const q = (id: string, time: number, lat = 42, lon = 12, mag = 2): Quake => ({ id, time, lat, lon, mag, place: id, depthKm: 10 });

describe('timeline', () => {
  it('sceglie barre di 1 h, 6 h o 1 giorno', () => {
    expect(binSize(24 * H)).toBe(H);
    expect(binSize(7 * 24 * H)).toBe(6 * H);
    expect(binSize(30 * 24 * H)).toBe(24 * H);
  });

  it('conta gli eventi per barra e scarta quelli fuori intervallo', () => {
    const bins = binEvents([q('a', 0.5 * H), q('b', 0.7 * H, 0, 0, 4), q('c', 2.1 * H), q('d', 10 * H)], 0, 3 * H, H);
    expect(bins.map(b => b.count)).toEqual([2, 0, 1]);
    expect(bins[0].maxMag).toBe(4);
  });

  it('filtra per finestra, anche se gli estremi sono invertiti', () => {
    const list = [q('a', 1), q('b', 5), q('c', 9)];
    expect(inWindow(list, [2, 8]).map(x => x.id)).toEqual(['b']);
    expect(inWindow(list, [8, 2]).map(x => x.id)).toEqual(['b']);
    expect(inWindow(list, null).length).toBe(3);
  });
});

describe('relazioni', () => {
  it('calcola le distanze', () => {
    expect(km({ lat: 41.9, lon: 12.5 }, { lat: 45.46, lon: 9.19 })).toBeCloseTo(477, -1);
  });

  it('trova eventi vicini nello spazio e nel tempo', () => {
    const base = q('x', 0, 42, 12);
    const list = [base, q('near', H, 42.1, 12), q('far', H, 44, 12), q('old', 100 * H, 42, 12)];
    expect(relatedQuakes(base, list).map(r => r.id)).toEqual(['near']);
  });

  it('aggrega per regione', () => {
    const m = countByRegion([q('a', 0, 1, 1, 2), q('b', 0, 1, 1, 3.5), q('c', 0, 9, 9)], lat => (lat < 5 ? 12 : null));
    expect(m.get(12)).toEqual({ count: 2, maxMag: 3.5 });
    expect(m.size).toBe(1);
  });
});

describe('allerte meteo', () => {
  it('riconosce temporali, rovesci e caldo', () => {
    expect(weatherAlert({ temp: 20, code: 95 })?.level).toBe('alarm');
    expect(weatherAlert({ temp: 20, code: 82 })?.level).toBe('warn');
    expect(weatherAlert({ temp: 36, code: 0 })?.label).toBe('Caldo intenso');
    expect(weatherAlert({ temp: 20, code: 3 })).toBeNull();
    expect(weatherAlert(null)).toBeNull();
  });
});

describe('coropleta', () => {
  it('assegna la classe giusta', () => {
    expect(stepColor(0, QUAKE_STEPS)).toBeNull();
    expect(stepColor(4, QUAKE_STEPS)).toBe(QUAKE_STEPS[1].color);
    expect(stepColor(-3, TEMP_STEPS)).toBe(TEMP_STEPS[0].color);
    expect(stepColor(null, TEMP_STEPS)).toBeNull();
  });
});

describe('stato nell\'URL', () => {
  it('fa il giro completo', () => {
    const s = parseView(
      serializeView({ lat: 43.77, lon: 11.25, z: 9, window: [100, 200], source: 'usgs', days: 30, minMag: 3, choro: 'quakes', sel: { kind: 'region', code: 9 } }) as Record<string, string>,
    );
    expect(s).toEqual({ lat: 43.77, lon: 11.25, z: 9, window: [100, 200], source: 'usgs', days: 30, minMag: 3, choro: 'quakes', sel: { kind: 'region', code: 9 } });
  });

  it('omette i default e scarta valori non validi', () => {
    const out = serializeView({ source: 'ingv', days: 7, minMag: 2, choro: 'none' });
    expect(Object.values(out).every(v => v === null)).toBe(true);
    expect(parseView({ lat: '999', lon: '1', z: '40', d: '5', m: '7', ch: 'x', sel: 'r:99' })).toEqual({});
    expect(parseView({ sel: 'q:abc' }).sel).toEqual({ kind: 'quake', id: 'abc' });
  });

  it('gestisce comuni, province, Italia e coropleta dei comuni', () => {
    for (const sel of [{ kind: 'comune', code: 'H501' }, { kind: 'province', code: 58 }, { kind: 'italy' }] as const) {
      expect(parseView(serializeView({ sel }) as Record<string, string>).sel).toEqual(sel);
    }
    expect(parseView({ ch: 'c:density' }).choro).toBe('c:density');
    expect(parseView({ ch: 'p:aqi' }).choro).toBe('p:aqi');
    expect(parseView({ ch: 'c:<script>' }).choro).toBeUndefined();
    expect(parseView({ sel: 'c:h501' }).sel).toBeUndefined();
  });
});
