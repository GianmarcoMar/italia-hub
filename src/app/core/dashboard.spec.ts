import { Comune } from './census';
import {
  PAIRS,
  Unit,
  aggregateUnit,
  alertExposure,
  areaOfRegion,
  areaTable,
  buildInsights,
  climateVars,
  comuneUnit,
  fmt,
  fmtVar,
  isSignificant,
  quakeRates,
  relationInsight,
  sizeClassOf,
  sizeTable,
  varById,
} from './dashboard';
import { aggregate } from './census';
import { Climate } from './history';

const REGS = [3, 8, 12, 15, 19]; // una regione per macro-area: NO, NE, C, S, I

/** Comuni sintetici: più anziani e più poveri man mano che i aumenta, più stranieri al Nord. */
function comuni(n = 200): Comune[] {
  return Array.from({ length: n }, (_, i) => {
    const reg = REGS[i % 5];
    const pop = 300 + i * 150;
    const old = 18 + (i % 50) * 0.5 + (i % 7) * 0.1; // over 65
    return {
      k: `A${String(i).padStart(3, '0')}`,
      name: `Comune ${i}`,
      istat: String(i),
      prov: reg * 10 + (i % 3),
      provAcr: 'XX',
      reg,
      area: 10 + (i % 11),
      x: 10 + (i % 7) * 0.1,
      y: 40 + (i % 9) * 0.1,
      pop,
      pop20: Math.round(pop * (1 + (i % 4 === 0 ? 0.03 : -0.02))),
      male: Math.round(pop / 2),
      female: pop - Math.round(pop / 2),
      ageMean: 38 + old / 3,
      pct0_14: 15 - old / 8,
      pct65: old,
      pctMarried: 50,
      foreign: Math.round(pop * (reg === 3 || reg === 8 ? 0.1 : 0.03)),
      taxpayers: Math.round(pop * 0.7),
      inc: 30000 - old * 400 + (i % 13) * 50, // più over 65 → reddito più basso
      inc19: 25000 - old * 330,
      inc14: 22000,
    };
  });
}

describe('unità di analisi', () => {
  it('traduce un comune nelle variabili confrontabili', () => {
    const c: Comune = { ...comuni(1)[0], pop: 1000, pop20: 1100, area: 10, foreign: 100, taxpayers: 700, inc: 20000, inc19: 16000 };
    const u = comuneUnit(c);
    expect(u.v.density).toBe(100);
    expect(u.v.popChange).toBeCloseTo(-9.0909, 3);
    expect(u.v.foreign).toBe(10);
    expect(u.v.incChange).toBe(25);
    expect(u.v.taxRatio).toBe(70);
    expect(u.area).toBe('NO');
  });

  it('lascia null i valori che mancano, senza inventarli', () => {
    const u = comuneUnit({ ...comuni(1)[0], pop: null, pop20: null, foreign: null, inc: null, taxpayers: null });
    expect(u.v.density).toBeNull();
    expect(u.v.popChange).toBeNull();
    expect(u.v.foreign).toBeNull();
    expect(u.v.incChange).toBeNull();
  });

  it('assegna ogni regione alla sua macro-area', () => {
    expect([1, 8, 12, 15, 19].map(areaOfRegion)).toEqual(['NO', 'NE', 'C', 'S', 'I']);
    expect(areaOfRegion(999)).toBe('C');
  });

  it('un territorio porta le sue variabili e quelle caricate a parte', () => {
    const u = aggregateUnit('province', '58', 'Roma', 12, 58, aggregate(comuni(20)), { quakeRate: 1.5 });
    expect(u.v.quakeRate).toBe(1.5);
    expect(u.v.density).toBeGreaterThan(0);
    expect(u.pop).toBeGreaterThan(0);
  });
});

describe('tabelle', () => {
  it('quote per macro-area che sommano a 100', () => {
    const rows = areaTable(comuni());
    expect(rows.map(r => r.id)).toEqual(['NO', 'NE', 'C', 'S', 'I']);
    expect(rows.reduce((s, r) => s + r.popShare, 0)).toBeCloseTo(100, 8);
    expect(rows.reduce((s, r) => s + r.foreignShare, 0)).toBeCloseTo(100, 8);
    // gli stranieri sono concentrati nelle aree con la quota più alta
    expect(rows[0].agg.pctForeign!).toBeGreaterThan(rows[3].agg.pctForeign!);
  });

  it('classi di dimensione', () => {
    expect([0, 999, 1000, 4999, 5000, 19999, 20000, 99999, 100000].map(sizeClassOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    const rows = sizeTable(comuni());
    expect(rows.reduce((s, r) => s + r.comuni, 0)).toBe(200);
    expect(rows.reduce((s, r) => s + r.popShare, 0)).toBeCloseTo(100, 8);
    expect(rows[0].shrinkingShare).not.toBeNull();
  });
});

describe('dati caricati a parte', () => {
  it('densità dei terremoti per provincia e per regione', () => {
    const provinces = [
      { prov: 1, reg: 1, area: 1000 },
      { prov: 2, reg: 1, area: 3000 },
      { prov: 3, reg: 2, area: 500 },
    ];
    const r = quakeRates(new Map([[1, 10], [2, 6], [3, 0]]), provinces);
    expect(r.byProv.get(1)).toBe(10);
    expect(r.byProv.get(2)).toBe(2);
    expect(r.byProv.get(3)).toBe(0);
    expect(r.byReg.get(1)).toBe(4); // 16 eventi su 4.000 km²
    expect(r.byReg.get(2)).toBe(0);
  });

  it('variabili climatiche sugli ultimi 30 anni e tendenza sull\'intera serie', () => {
    const c: Climate = {
      years: Array.from({ length: 35 }, (_, i) => ({ year: 1991 + i, t: i < 5 ? 0 : 10, p: 800 })),
      normals: [],
      trendPerDecade: 0.4,
    };
    expect(climateVars(c)).toEqual({ tempMean: 10, rain: 800, tempTrend: 0.4 });
  });

  it('esposizione alle allerte: comuni, abitanti e over 65 per livello', () => {
    const list = comuni(10);
    const e = alertExposure(list, c => (c.k === 'A000' ? 2 : c.k === 'A001' ? 3 : 0));
    expect(e.comuni).toEqual([8, 0, 1, 1]);
    expect(e.pop.reduce((s, v) => s + v, 0)).toBe(list.reduce((s, c) => s + (c.pop ?? 0), 0));
    expect(e.over65[2]).toBeCloseTo((list[0].pop! * list[0].pct65!) / 100, 8);
    expect(alertExposure(list, () => 9).comuni).toEqual([0, 0, 0, 10]); // i livelli fuori scala si limitano a rossa
  });
});

describe('significatività e formati', () => {
  it('con pochi punti serve una correlazione più forte', () => {
    expect(isSignificant(0.3, 20)).toBe(false);
    expect(isSignificant(0.5, 20)).toBe(true);
    expect(isSignificant(0.05, 8000)).toBe(true);
    expect(isSignificant(0.9, 4)).toBe(false); // meno di 5 punti
  });

  it('formati in italiano con segno solo per le variazioni', () => {
    expect(fmt(12345.5, 1)).toBe('12.345,5');
    expect(fmt(1234, 0)).toBe('1.234'); // sempre raggruppato, anche a quattro cifre
    expect(fmt(-1234567.891, 2)).toBe('-1.234.567,89');
    expect(fmt(-0.04, 1)).toBe('0,0'); // niente "-0,0"
    expect(fmt(0)).toBe('0');
    expect(fmt(999.5, 0)).toBe('1.000');
    expect(fmtVar(varById('popChange'), 2.5)).toBe('+2,5%');
    expect(fmtVar(varById('popChange'), -2.5)).toBe('-2,5%');
    expect(fmtVar(varById('inc'), 21500)).toBe('21.500 €');
    expect(fmtVar(varById('quakeRate'), 1.234)).toBe('1,23');
  });
});

describe('conclusioni', () => {
  const list = comuni();
  const provinceUnits = (): Unit[] => {
    const by = new Map<number, Comune[]>();
    for (const c of list) by.set(c.prov, [...(by.get(c.prov) ?? []), c]);
    return [...by].map(([p, l]) => aggregateUnit('province', String(p), `Provincia ${p}`, l[0].reg, p, aggregate(l)));
  };
  const units = (): Record<'comune' | 'province' | 'region', Unit[]> => ({ comune: list.map(comuneUnit), province: provinceUnits(), region: [] });

  it('riconosce una relazione forte e dice il verso e i numeri', () => {
    const i = relationInsight('comune', 'pct65', 'inc', units().comune)!;
    expect(i.text).toMatch(/correlazione (forte|molto forte) negativa/);
    expect(i.text).toContain('200 comuni');
    expect(i.text).toMatch(/vale in media/);
    expect(i.title).toBe('Over 65 e reddito medio 2024');
    expect(i.facts).toContain('n = 200');
    expect(i.weight).toBeGreaterThan(0.6);
    expect(i.action).toMatchObject({ kind: 'plot', x: 'pct65', y: 'inc' });
  });

  it('dice che non c\'è relazione quando non c\'è', () => {
    // il reddito non dipende dalla densità nei dati sintetici: la relazione è trascurabile o assente
    const u = units().comune.map((c, i) => ({ ...c, v: { ...c.v, density: (i * 7919) % 101 } }));
    const i = relationInsight('comune', 'density', 'inc', u)!;
    expect(i.text).toMatch(/non mostrano una relazione apprezzabile|correlazione (debole|trascurabile)/);
  });

  describe('con poche unità (20 regioni)', () => {
    const regions = (y: number[]): Unit[] =>
      y.map((v, i) => ({ id: String(i), name: `Regione ${i}`, level: 'region' as const, reg: 1, prov: null, area: 'C' as const, pop: 1, v: { tempTrend: i + 1, popChange: v } }));
    const WEAK = [14, 3, 9, 1, 6, 17, 4, 12, 2, 15, 7, 20, 10, 11, 8, 16, 5, 19, 13, 18]; // ρ ≈ 0,42: con 20 punti non è distinguibile dal caso
    const CLEAR = [9, 3, 14, 1, 6, 17, 4, 12, 2, 15, 7, 20, 5, 11, 8, 16, 10, 19, 13, 18]; // ρ ≈ 0,47: lo è

    it('una correlazione moderata ma non significativa non viene presentata come un fatto', () => {
      const i = relationInsight('region', 'tempTrend', 'popChange', regions(WEAK))!;
      expect(i.text).toContain('Tra le 20 regioni');
      expect(i.text).toContain('si intravede una correlazione moderata positiva');
      expect(i.text).toContain('non si distingue dal caso');
      expect(i.text).not.toContain('hanno una correlazione');
    });

    it('una correlazione significativa riporta le due metà e l\'avvertenza sul numero di regioni', () => {
      const i = relationInsight('region', 'tempTrend', 'popChange', regions(CLEAR))!;
      expect(i.text).toContain('hanno una correlazione moderata positiva');
      expect(i.text).toContain('Nella metà con i valori più alti di tendenza della temperatura');
      expect(i.text).toContain('nella metà con i valori più bassi');
      expect(i.text).toContain('Con solo 20 regioni il risultato è indicativo');
    });

    it('le relazioni incerte vengono dopo quelle solide a parità di ρ', () => {
      const weak = relationInsight('region', 'tempTrend', 'popChange', regions(WEAK))!;
      const clear = relationInsight('region', 'tempTrend', 'popChange', regions(CLEAR))!;
      expect(weak.weight!).toBeCloseTo(0.423 / 2, 2);
      expect(clear.weight!).toBeCloseTo(0.468, 2);
    });
  });

  it('senza dati sufficienti non inventa nulla', () => {
    expect(relationInsight('comune', 'pct65', 'inc', units().comune.slice(0, 2))).toBeNull();
    expect(relationInsight('province', 'quakeRate', 'density', [])).toBeNull();
    expect(buildInsights({ comuni: list.slice(0, 5), units: units() })).toEqual([]);
  });

  it('costruisce le conclusioni nell\'ordine divari, demografia, relazioni e omette i dati non caricati', () => {
    const all = buildInsights({ comuni: list, units: units() });
    const ids = all.map(i => i.id);
    expect(ids).toContain('income-gap');
    expect(ids).toContain('shrinking');
    expect(ids).toContain('ageing');
    expect(ids).not.toContain('quake-exposure');
    expect(ids).not.toContain('alerts-today');
    expect(ids).not.toContain('climate');
    const order = ['divari', 'demografia', 'relazioni', 'rischi'];
    const groups = all.map(i => order.indexOf(i.group));
    // 'divari' e 'demografia' sono mescolati in testa, ma le relazioni vengono dopo e sono ordinate per forza
    const rels = all.filter(i => i.group === 'relazioni');
    expect(rels.length).toBeGreaterThan(3);
    expect(rels.map(r => r.weight)).toEqual([...rels.map(r => r.weight!)].sort((a, b) => b - a));
    expect(groups.lastIndexOf(0)).toBeLessThan(groups.indexOf(2));
  });

  it('ogni conclusione ha testo, un\'azione verificabile e numeri coerenti', () => {
    for (const i of buildInsights({ comuni: list, units: units() })) {
      expect(i.text.length).toBeGreaterThan(30);
      expect(i.text).not.toMatch(/NaN|undefined|Infinity/);
      expect(i.action).toBeDefined();
    }
  });

  it('include le allerte e la sismicità quando i dati arrivano', () => {
    const e = alertExposure(list, c => (c.reg === 3 ? 2 : 0));
    const provinces: Unit[] = Array.from({ length: 6 }, (_, i) => ({
      ...aggregateUnit('province', String(i), `Prov ${i}`, REGS[i % 5], i, aggregate(list.slice(i * 30, i * 30 + 30)), { quakeRate: i }),
    }));
    const all = buildInsights({
      comuni: list,
      units: { ...units(), province: provinces },
      alerts: { exposure: e, title: 'Bollettino di prova' },
      quake: { total: 12345, fromYear: 1985 },
    });
    const a = all.find(i => i.id === 'alerts-today')!;
    expect(a.tone).toBe('warn');
    expect(a.text).toMatch(/comuni .* sono in allerta gialla o superiore/);
    expect(a.text).not.toMatch(/NaN/);
    expect(all.find(i => i.id === 'quake-exposure')!.text).toContain('12.345 terremoti');

    const none = buildInsights({ comuni: list, units: units(), alerts: { exposure: alertExposure(list, () => 0), title: null } });
    expect(none.find(i => i.id === 'alerts-today')).toMatchObject({ tone: 'good', text: expect.stringContaining('nessun comune') });
  });

  it('le coppie previste hanno variabili disponibili al livello indicato', () => {
    for (const p of PAIRS) {
      expect(varById(p.x).levels).toContain(p.level);
      expect(varById(p.y).levels).toContain(p.level);
    }
  });
});
