import {
  ckanText,
  containsPoint,
  isPlace,
  parseUtc,
  toDataset,
  toNowWeather,
  toQuakes,
  toReversePlace,
} from './parsers';

// Esempi ridotti da risposte reali (ottobre 2026)

describe('parseUtc', () => {
  it('legge gli orari INGV senza fuso come UTC', () => {
    expect(parseUtc('2026-10-08T13:39:40.410000')).toBe(Date.UTC(2026, 9, 8, 13, 39, 40, 410));
  });
  it('rispetta un fuso esplicito', () => {
    expect(parseUtc('2026-10-08T15:39:40+02:00')).toBe(Date.UTC(2026, 9, 8, 13, 39, 40));
    expect(parseUtc('2026-10-08T13:39:40Z')).toBe(Date.UTC(2026, 9, 8, 13, 39, 40));
  });
  it('lascia invariati i ms epoch di USGS', () => {
    expect(parseUtc(1791454048642)).toBe(1791454048642);
  });
});

describe('toQuakes', () => {
  it('gestisce la risposta 204 di INGV (corpo null)', () => {
    expect(toQuakes(null)).toEqual([]);
  });

  it('converte una feature INGV', () => {
    const [q] = toQuakes({
      features: [
        {
          type: 'Feature',
          properties: { eventId: 47478012, time: '2026-10-08T13:39:40.410000', mag: 3.1, place: 'Golfo di Policastro' },
          geometry: { type: 'Point', coordinates: [15.6695, 39.9587, 286] },
        },
      ],
    });
    expect(q).toEqual({
      id: '47478012',
      mag: 3.1,
      place: 'Golfo di Policastro',
      time: Date.UTC(2026, 9, 8, 13, 39, 40, 410),
      lat: 39.9587,
      lon: 15.6695,
      depthKm: 286,
      url: undefined,
    });
  });

  it('converte una feature USGS e scarta quelle senza coordinate', () => {
    const list = toQuakes({
      features: [
        {
          id: 'us6000u0xn',
          properties: { mag: 5.1, place: '236 km E of Levuka, Fiji', time: 1791454048642, url: 'https://x' },
          geometry: { coordinates: [-178, -17.7, 10] },
        },
        { id: 'rotto', properties: {}, geometry: null },
      ],
    });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('us6000u0xn');
    expect(list[0].url).toBe('https://x');
  });
});

describe('dati.gov.it', () => {
  it('sceglie l\'italiano nei campi multilingua', () => {
    expect(ckanText({ en: 'Transport', it: 'Trasporti' })).toBe('Trasporti');
    expect(ckanText({ en: 'Transport' })).toBe('Transport');
    expect(ckanText(null)).toBe('');
  });

  it('deduplica i formati', () => {
    const d = toDataset({ id: 'a b', title: 'T', resources: [{ format: 'csv' }, { format: 'CSV' }, { format: '' }] });
    expect(d.formats).toEqual(['CSV']);
    expect(d.url).toContain('id=a%20b');
  });
});


describe('toReversePlace', () => {
  it('usa città, provincia e regione, con il nome inglese', () => {
    const p = toReversePlace(
      {
        name: 'Firenze',
        address: { city: 'Firenze', county: 'Firenze', state: 'Toscana', country: 'Italia' },
        namedetails: { name: 'Firenze', 'name:en': 'Florence' },
      },
      43.77,
      11.25,
    );
    expect(p).toEqual({ name: 'Firenze', detail: 'Toscana, Italia', lat: 43.77, lon: 11.25, nameEn: 'Florence' });
  });
  it('ritorna null in mare', () => {
    expect(toReversePlace({ error: 'Unable to geocode' }, 40, 12)).toBeNull();
    expect(toReversePlace({ name: 'Italia', addresstype: 'country', address: { country: 'Italia' } }, 42.6, 10.9)).toBeNull();
  });
});

describe('toNowWeather', () => {
  it('accetta sia array (più punti) sia oggetto (un punto)', () => {
    const one = { current: { temperature_2m: 22.7, weather_code: 80 } };
    expect(toNowWeather(one)).toEqual([{ temp: 22.7, code: 80 }]);
    expect(toNowWeather([one, one]).length).toBe(2);
  });
});

describe('containsPoint', () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
  it('riconosce interno, esterno e buchi', () => {
    expect(containsPoint({ type: 'Polygon', coordinates: square }, 2, 2)).toBe(true);
    expect(containsPoint({ type: 'Polygon', coordinates: square }, 5, 5)).toBe(false);
    expect(containsPoint({ type: 'MultiPolygon', coordinates: [square] }, 20, 2)).toBe(false);
  });
});

describe('isPlace', () => {
  it('rifiuta valori corrotti in localStorage', () => {
    expect(isPlace({ name: 'Roma', detail: '', lat: 41.9, lon: 12.5 })).toBe(true);
    expect(isPlace({ name: 'Roma' })).toBe(false);
    expect(isPlace('Roma')).toBe(false);
  });
});
