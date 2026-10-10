import { AlertZone } from '../core/alerts';
import { Quake } from '../core/parsers';
import { alertTip, comuneStyle, quakeStyle, quakeTip, tip } from './map-helpers';

describe('stile dei comuni', () => {
  const ACCENT = '#2dd4bf';
  const LINE = 'rgba(0,0,0,0.3)';

  it('da vicino: bordo sottile, riempimento solo con la coropleta', () => {
    expect(comuneStyle(undefined, false, ACCENT, LINE)).toEqual({
      color: LINE,
      weight: 0.6,
      opacity: 1,
      fill: true,
      fillColor: ACCENT,
      fillOpacity: 0,
    });
    expect(comuneStyle('#f00', false, ACCENT, LINE)).toMatchObject({ fillColor: '#f00', fillOpacity: 0.68, weight: 0.6 });
  });

  it('da lontano: i bordi spariscono dove c\'è il colore e il colore è più pieno', () => {
    expect(comuneStyle('#f00', false, ACCENT, LINE, true)).toMatchObject({ weight: 0, fillOpacity: 0.78 });
    expect(comuneStyle(undefined, false, ACCENT, LINE, true)).toMatchObject({ weight: 0.3, fillOpacity: 0 });
  });

  it('il comune selezionato ha il bordo forte e un velo del colore d\'accento', () => {
    expect(comuneStyle(undefined, true, ACCENT, LINE)).toMatchObject({ color: ACCENT, weight: 2.5, fillOpacity: 0.12 });
    expect(comuneStyle('#f00', true, ACCENT, LINE, true)).toMatchObject({ color: ACCENT, weight: 2.5, fillOpacity: 0.78 });
  });
});

describe('tooltip', () => {
  it('mette il testo come testo, mai come HTML', () => {
    const el = tip('<img src=x onerror=alert(1)>', '<b>grassetto</b>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('strong')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('span')?.textContent).toBe('<b>grassetto</b>');
  });

  it('senza dettaglio non crea la riga secondaria', () => {
    expect(tip('Solo titolo').querySelector('span')).toBeNull();
    expect(tip('Titolo', '').querySelector('span')).not.toBeNull();
  });

  it('descrive un evento sismico e una zona d\'allerta', () => {
    const q: Quake = { id: '1', mag: 3.14, place: 'Golfo <di> Policastro', time: Date.UTC(2026, 9, 8, 13, 39), lat: 40, lon: 15, depthKm: 12.4 };
    const e = quakeTip(q);
    expect(e.querySelector('strong')?.textContent).toBe('M 3.1 · Golfo <di> Policastro');
    expect(e.querySelector('span')?.textContent).toContain('12 km');
    expect(quakeTip({ ...q, depthKm: null }).querySelector('span')?.textContent).not.toContain('km');

    const zone = { name: 'Lazio A', level: 2, summary: 'Moderata / ALLERTA ARANCIONE' } as AlertZone;
    expect(alertTip(zone).querySelector('span')?.textContent).toBe('Moderata / ALLERTA ARANCIONE');
    expect(alertTip({ ...zone, level: 0 }).querySelector('span')?.textContent).toBe('Nessuna allerta');
  });

  it('il raggio degli eventi cresce con la magnitudo e si evidenzia al passaggio', () => {
    const q: Quake = { id: '1', mag: 1, place: '', time: 0, lat: 0, lon: 0, depthKm: 5 };
    expect(quakeStyle(q, false).radius).toBe(4.2);
    expect(quakeStyle({ ...q, mag: 0 }, false).radius).toBe(3);
    expect(quakeStyle(q, true)).toMatchObject({ weight: 3, fillOpacity: 0.85 });
    expect(quakeStyle(q, false)).toMatchObject({ weight: 1.5, fillOpacity: 0.3 });
  });
});
