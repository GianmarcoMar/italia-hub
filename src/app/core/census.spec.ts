import { COMUNE_METRICS, CensusFile, aggregate, metricById, metricSteps, mostPopulous, parseCensus, quantileBreaks, rankOf, sumArrays } from './census';

const FIELDS = [
  'name', 'istat', 'prov', 'provAcr', 'reg', 'area', 'x', 'y',
  'pop', 'pop20', 'male', 'female', 'ageMean', 'pct0_14', 'pct65', 'pctMarried', 'foreign',
  'taxpayers', 'inc', 'inc19', 'inc14',
];

// righe ridotte dai dati veri (comuni.json)
const file: CensusFile = {
  generated: '2026-10-08',
  popYears: [2020, 2025],
  incomeYears: [2014, 2019, 2024],
  sources: {},
  fields: FIELDS,
  rows: {
    G478: ['Perugia', '054039', 54, 'PG', 10, 449.13, 12.41, 43.16, 162050, 164880, 78119, 83931, 47.3, 11.5, 25.7, 43.3, 20887, 123262, 27498, 23234, 22022],
    F911: ['Nocera Umbra', '054034', 54, 'PG', 10, 157.2, 12.79, 43.11, 5600, 5900, 2750, 2850, 49, 10, 30, 45, 300, 4300, 21000, 19000, null],
    X999: ['Nuovo', '054999', 54, 'PG', 10, 10, 12.5, 43.1, 1000, null, 500, 500, 40, 15, 15, 40, 50, null, null, null, null],
  },
};

describe('censimento', () => {
  const map = parseCensus(file);
  const all = [...map.values()];

  it('legge le righe per nome di campo', () => {
    const p = map.get('G478')!;
    expect(p.name).toBe('Perugia');
    expect(p.provAcr).toBe('PG');
    expect(p.inc14).toBe(22022);
    expect(map.get('F911')!.inc14).toBeNull();
  });

  it('aggrega con medie pesate e variazioni omogenee', () => {
    const a = aggregate(all);
    expect(a.comuni).toBe(3);
    expect(a.pop).toBe(168650);
    // la variazione usa solo i comuni con il dato 2020
    expect(a.popChange).toBeCloseTo(((162050 + 5600 - 164880 - 5900) / (164880 + 5900)) * 100, 6);
    // reddito pesato per contribuenti (il comune senza contribuenti non conta)
    expect(a.inc).toBeCloseTo((27498 * 123262 + 21000 * 4300) / (123262 + 4300), 6);
    expect(a.density).toBeCloseTo(168650 / (449.13 + 157.2 + 10), 6);
    expect(a.oldAgeIndex).toBeGreaterThan(200);
  });

  it('classifica e trova il capoluogo', () => {
    expect(rankOf(all, 'F911', c => c.pop)).toEqual({ rank: 2, of: 3 });
    expect(rankOf(all, 'X999', c => c.inc)).toBeNull();
    expect(mostPopulous(all)?.k).toBe('G478');
  });

  it('somma array anche di lunghezza diversa', () => {
    expect(sumArrays([[1, 2], [3, null, 5], undefined])).toEqual([4, 2, 5]);
  });

  it('calcola soglie e legende', () => {
    expect(quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)[0]).toBe(-Infinity);
    const steps = metricSteps(metricById('popChange')!, all);
    expect(steps.length).toBe(6);
    expect(steps[0].label.startsWith('<')).toBe(true);
    expect(COMUNE_METRICS.every(m => typeof m.value(map.get('G478')!) === 'number')).toBe(true);
  });
});
