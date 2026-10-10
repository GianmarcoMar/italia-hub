import { parseIngvText, parseOverpassCounts, parsePower, parseWikiFacts, perYear, slope } from './history';

describe('clima NASA POWER', () => {
  const months = (y: number, t: number) =>
    Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`${y}${String(i + 1).padStart(2, '0')}`, i === 12 ? 99 : t]));
  const r = {
    properties: {
      parameter: {
        T2M: { ...months(1991, 14), ...months(2000, 15), ...months(2020, 16) },
        PRECTOTCORR: { ...months(1991, 2), ...months(2000, 2), ...months(2020, 2) },
      },
    },
  };

  it('calcola medie annue, piogge e tendenza (ignorando il mese 13)', () => {
    const c = parsePower(r)!;
    expect(c.years.map(y => y.year)).toEqual([1991, 2000, 2020]);
    expect(c.years[0].t).toBeCloseTo(14, 6);
    expect(c.years[0].p).toBeCloseTo(2 * 365.25, 1);
    expect(c.trendPerDecade).toBeGreaterThan(0.6);
    expect(c.normals[0].t).toBeCloseTo(15, 6);
  });

  it('scarta gli anni incompleti e i -999', () => {
    const c = parsePower({ properties: { parameter: { T2M: { '202401': -999 }, PRECTOTCORR: {} } } });
    expect(c).toBeNull();
  });

  it('calcola la pendenza', () => {
    expect(slope([[0, 1], [1, 3], [2, 5]])).toBeCloseTo(2, 6);
  });
});

describe('INGV testo', () => {
  const text = [
    '#EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType',
    '45591912|2026-04-16T02:05:32.280000|43.8765|11.2638|9.9|SURVEY-INGV||||ML|2.1|--|4 km SW Vaglia (FI)|earthquake',
    '40228302|2024-08-18T20:19:45.900000|43.982|11.2872|69.4|BULLETIN-INGV||||ML|3.2|--|4 km NW Scarperia (FI)|earthquake',
    'riga rotta',
  ].join('\n');

  it('legge eventi e orari UTC', () => {
    const q = parseIngvText(text);
    expect(q.length).toBe(2);
    expect(q[0]).toEqual({ id: '45591912', time: Date.UTC(2026, 3, 16, 2, 5, 32, 280), lat: 43.8765, lon: 11.2638, depthKm: 9.9, mag: 2.1, place: '4 km SW Vaglia (FI)' });
    expect(parseIngvText(null)).toEqual([]);
  });

  it('conta per anno includendo gli anni vuoti', () => {
    expect(perYear(parseIngvText(text), 2024, 2026)).toEqual([
      { year: 2024, n: 1 },
      { year: 2025, n: 0 },
      { year: 2026, n: 1 },
    ]);
  });
});

describe('Wikidata e OSM', () => {
  it('legge i fatti e scarta link non http', () => {
    const f = parseWikiFacts({
      results: { bindings: [{ item: { value: 'Q3437' }, label: { value: 'Perugia' }, elevation: { value: '493' }, website: { value: 'javascript:alert(1)' } }] },
    })!;
    expect(f.label).toBe('Perugia');
    expect(f.elevation).toBe(493);
    expect(f.website).toBeNull();
    expect(parseWikiFacts({ results: { bindings: [] } })).toBeNull();
  });

  it('legge i conteggi di Overpass in ordine', () => {
    expect(parseOverpassCounts({ elements: [{ type: 'count', tags: { total: '3' } }, { type: 'count', tags: { total: '11' } }] })).toEqual([3, 11]);
  });
});
