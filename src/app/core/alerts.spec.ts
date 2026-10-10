import { AlertZone, alertLevel, bulletinText, fixMojibake, indexZones, latestBulletinId, normName, zoneFor } from './alerts';

const square = (x: number, y: number) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]],
});

const zone = (name: string, comuni: string[], level: 0 | 1 | 2 | 3, geom = square(0, 0)): AlertZone => ({
  name,
  level,
  summary: '',
  risks: { idraulico: 0, temporali: level, idrogeologico: 0 },
  comuni,
  geometry: geom,
});

describe('allerte DPC', () => {
  it('legge i livelli dai testi del bollettino', () => {
    expect(alertLevel('Assenza di fenomeni significativi prevedibili / NESSUNA ALLERTA')).toBe(0);
    expect(alertLevel('Ordinaria per rischio temporali / ALLERTA GIALLA')).toBe(1);
    expect(alertLevel('Moderata per rischio idrogeologico / ALLERTA ARANCIONE')).toBe(2);
    expect(alertLevel('Elevata / ALLERTA ROSSA')).toBe(3);
  });

  it('ripara i nomi con codifica sbagliata e li normalizza', () => {
    expect(fixMojibake("CittÃ  Sant'Angelo")).toBe("Città Sant'Angelo");
    expect(fixMojibake("CittÃ  Sant'Angelo")).toBe("Città Sant'Angelo"); // 0xA0 diventato spazio
    expect(fixMojibake('PerÃ²')).toBe('Però');
    expect(fixMojibake('Città')).toBe('Città');
    expect(normName("CittÃ  Sant'Angelo")).toBe('citta sant angelo');
    expect(normName("Sant'Egidio alla Vibrata")).toBe(normName('Sant’Egidio  alla Vibrata'));
  });

  it('trova l\'ultimo bollettino dai nomi dei file', () => {
    expect(latestBulletinId(['files/preview/20261008_1521_domani.png', 'files/20261007_1500.json', 'README.md'])).toBe('20261008_1521');
    expect(latestBulletinId(['x'])).toBeNull();
  });

  it('assegna la zona, distinguendo gli omonimi con la geometria', () => {
    const idx = indexZones([zone('Nord', ['Castro', 'Alfa'], 1, square(0, 0)), zone('Sud', ['Castro'], 2, square(5, 5))]);
    expect(zoneFor(idx, 'Alfa', 0.5, 0.5)?.name).toBe('Nord');
    expect(zoneFor(idx, 'Castro', 5.5, 5.5)?.name).toBe('Sud');
    expect(zoneFor(idx, 'Ignoto', 0, 0)).toBeNull();
    // nomi bilingui e doppi
    const idx2 = indexZones([zone('Adige', ['Appiano sulla Strada del Vino', 'Tripi'], 1)]);
    expect(zoneFor(idx2, 'Appiano sulla strada del vino/Eppan an der Weinstraße', 0.5, 0.5)?.name).toBe('Adige');
    expect(zoneFor(idx2, 'Tripi - Abakainon', 0.5, 0.5)?.name).toBe('Adige');
  });

  it('estrae il testo dalla descrizione HTML', () => {
    expect(bulletinText('<p>Oggi:<br/><b>ALLERTA GIALLA</b><br />Toscana: Arno&#39;</p>')).toEqual(['Oggi:', 'ALLERTA GIALLA', "Toscana: Arno'"]);
  });
});
