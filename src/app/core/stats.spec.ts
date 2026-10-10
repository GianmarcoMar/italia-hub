import { linreg, mean, median, niceTicks, pairs, pearson, quantileGroups, ranks, relation, spearman, strength, wmean } from './stats';

describe('statistica di base', () => {
  it('medie e mediana', () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(mean([])).toBeNaN();
    expect(wmean([10, 20], [1, 3])).toBe(17.5);
    expect(wmean([10, 20], [0, 0])).toBeNaN();
    expect(wmean([10, 20], [-5, 1])).toBe(20); // i pesi negativi non contano
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('scarta le coppie con valori mancanti', () => {
    const p = pairs([1, null, 3, NaN, 5], [2, 4, undefined, 8, 10]);
    expect(p).toEqual({ x: [1, 5], y: [2, 10], idx: [0, 4] });
  });

  it('Pearson: relazione lineare perfetta, inversa, nulla e casi limite', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull(); // serie costante
    expect(pearson([1, 2], [1, 2])).toBeNull(); // troppo pochi punti
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 10);
  });

  it('ranghi con i pari merito alla posizione media', () => {
    expect(ranks([10, 30, 20])).toEqual([1, 3, 2]);
    expect(ranks([5, 5, 1, 9])).toEqual([2.5, 2.5, 1, 4]);
  });

  it('Spearman coglie le relazioni monotone anche se non lineari e ignora i valori estremi', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = x.map(v => v ** 5);
    expect(spearman(x, y)).toBeCloseTo(1, 10);
    expect(pearson(x, y)!).toBeLessThan(0.99);
    // un valore estremo sposta Pearson ma non il rango
    expect(spearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 1000])).toBeCloseTo(1, 10);
    expect(spearman([1, 2], [2, 1])).toBeNull();
  });

  it('retta dei minimi quadrati', () => {
    const l = linreg([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(l.slope).toBeCloseTo(2, 10);
    expect(l.intercept).toBeCloseTo(1, 10);
    expect(l.r2).toBeCloseTo(1, 10);
    expect(linreg([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('etichette della forza della correlazione', () => {
    expect([0.05, 0.3, 0.5, 0.7, 0.95].map(strength)).toEqual(['trascurabile', 'debole', 'moderata', 'forte', 'molto forte']);
    expect(strength(-0.7)).toBe('forte');
  });

  it('gruppi per quantile con media pesata', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = x.map(v => v * 10);
    const g = quantileGroups(x, y, 5);
    expect(g.map(q => q.n)).toEqual([2, 2, 2, 2, 2]);
    expect(g[0]).toMatchObject({ from: 1, to: 2, x: 1.5, y: 15 });
    expect(g[4]).toMatchObject({ from: 9, to: 10, y: 95 });
    // il peso sposta la media di y dentro il gruppo
    const gw = quantileGroups(x, y, 5, [1, 3, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(gw[0].y).toBeCloseTo((10 * 1 + 20 * 3) / 4, 10);
    expect(quantileGroups([1, 2], [1, 2], 5)).toEqual([]);
  });

  it('tacche tonde per gli assi', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6]);
    expect(niceTicks(0.1, 0.45, 3)).toEqual([0.2, 0.4]);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(12000, 31000, 4)).toEqual([15000, 20000, 25000, 30000]);
  });

  it('relazione tra due colonne con buchi', () => {
    const r = relation([1, 2, 3, null, 5, 6], [2, 4, 6, 99, 10, 12])!;
    expect(r.n).toBe(5);
    expect(r.rho).toBeCloseTo(1, 10);
    expect(r.line.slope).toBeCloseTo(2, 10);
    expect(relation([1, 2], [1, 2])).toBeNull();
  });
});
