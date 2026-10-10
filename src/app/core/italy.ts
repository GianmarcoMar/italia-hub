/** Dati statici sull'Italia: regioni (codici ISTAT) e capoluoghi, usati da mappa e pannelli. */

export interface Region {
  code: number; // codice ISTAT, come reg_istat_code_num nei GeoJSON
  name: string;
  /** Nome inglese, per cercare nella collezione del Met. */
  en: string;
  capital: Capital;
}

export interface Capital {
  name: string;
  en: string;
  lat: number;
  lon: number;
}

const r = (code: number, name: string, en: string, capital: Capital): Region => ({ code, name, en, capital });
const c = (name: string, en: string, lat: number, lon: number): Capital => ({ name, en, lat, lon });

export const REGIONS: Region[] = [
  r(1, 'Piemonte', 'Piedmont', c('Torino', 'Turin', 45.0703, 7.6869)),
  r(2, "Valle d'Aosta", 'Aosta Valley', c('Aosta', 'Aosta', 45.737, 7.3201)),
  r(3, 'Lombardia', 'Lombardy', c('Milano', 'Milan', 45.4642, 9.19)),
  r(4, 'Trentino-Alto Adige', 'Trentino', c('Trento', 'Trento', 46.0679, 11.1211)),
  r(5, 'Veneto', 'Veneto', c('Venezia', 'Venice', 45.4408, 12.3155)),
  r(6, 'Friuli-Venezia Giulia', 'Friuli', c('Trieste', 'Trieste', 45.6495, 13.7768)),
  r(7, 'Liguria', 'Liguria', c('Genova', 'Genoa', 44.4056, 8.9463)),
  r(8, 'Emilia-Romagna', 'Emilia-Romagna', c('Bologna', 'Bologna', 44.4949, 11.3426)),
  r(9, 'Toscana', 'Tuscany', c('Firenze', 'Florence', 43.7696, 11.2558)),
  r(10, 'Umbria', 'Umbria', c('Perugia', 'Perugia', 43.1107, 12.3908)),
  r(11, 'Marche', 'Marche', c('Ancona', 'Ancona', 43.6158, 13.5189)),
  r(12, 'Lazio', 'Lazio', c('Roma', 'Rome', 41.8919, 12.5113)),
  r(13, 'Abruzzo', 'Abruzzo', c("L'Aquila", "L'Aquila", 42.3498, 13.3995)),
  r(14, 'Molise', 'Molise', c('Campobasso', 'Campobasso', 41.5603, 14.6627)),
  r(15, 'Campania', 'Campania', c('Napoli', 'Naples', 40.8518, 14.2681)),
  r(16, 'Puglia', 'Apulia', c('Bari', 'Bari', 41.1171, 16.8719)),
  r(17, 'Basilicata', 'Basilicata', c('Potenza', 'Potenza', 40.6404, 15.8056)),
  r(18, 'Calabria', 'Calabria', c('Catanzaro', 'Catanzaro', 38.9098, 16.5877)),
  r(19, 'Sicilia', 'Sicily', c('Palermo', 'Palermo', 38.1157, 13.3615)),
  r(20, 'Sardegna', 'Sardinia', c('Cagliari', 'Cagliari', 39.2238, 9.1217)),
];

export const regionByCode = (code: number | undefined) => REGIONS.find(x => x.code === code);

/** Riquadro che contiene tutta l'Italia, isole comprese: [[sud, ovest], [nord, est]]. */
export const ITALY_BOUNDS: [[number, number], [number, number]] = [
  [35.4, 6.6],
  [47.1, 18.6],
];
