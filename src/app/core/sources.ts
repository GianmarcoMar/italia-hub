export interface Source {
  name: string;
  area: string;
  license: string;
  limits: string;
  url: string;
}

/** Fonti usate e condizioni verificate sui siti ufficiali (ottobre 2026). Mostrate nella finestra Fonti. */
export const SOURCES: Source[] = [
  {
    name: 'Open-Meteo',
    area: 'Meteo, qualità dell’aria, pollini, mare, geocoding',
    license: 'Dati CC BY 4.0',
    limits: 'Gratis solo non commerciale, meno di 10.000 chiamate al giorno',
    url: 'https://open-meteo.com/en/terms',
  },
  {
    name: 'Protezione Civile · bollettini di criticità',
    area: 'Allerte meteo-idrogeologiche per zona e comune',
    license: 'CC BY 4.0',
    limits: 'Repository GitHub pcm-dpc, bollettino aggiornato più volte al giorno',
    url: 'https://github.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica',
  },
  {
    name: 'INGV · FDSN event',
    area: 'Terremoti in Italia, anche storici dal 1985',
    license: 'Dati aperti (licenza esatta da verificare)',
    limits: 'Nessuna chiave',
    url: 'https://terremoti.ingv.it/en/webservices_and_software',
  },
  {
    name: 'USGS · FDSN event',
    area: 'Terremoti nel mondo',
    license: 'Pubblico dominio (USA), credito richiesto: U.S. Geological Survey',
    limits: 'Nessuna chiave',
    url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  },
  {
    name: 'ISTAT · popolazione residente (POSAS) e struttura (STRASA)',
    area: 'Demografia dei comuni 2019–2025, età, sesso, stranieri',
    license: 'CC BY 4.0',
    limits: 'File statici elaborati con npm run data',
    url: 'https://www.istat.it/',
  },
  {
    name: 'MEF · dichiarazioni IRPEF per comune',
    area: 'Redditi dei comuni 2014–2024, fasce e tipo di reddito',
    license: 'CC BY 3.0 IT',
    limits: 'File statici elaborati con npm run data',
    url: 'https://www1.finanze.gov.it/finanze/analisidichiarazioni/',
  },
  {
    name: 'ISTAT · confini amministrativi',
    area: 'Regioni, province e comuni sulla mappa (1/1/2026, via geojson-italy)',
    license: 'CC BY 4.0',
    limits: 'File statici inclusi nell’app, semplificati',
    url: 'https://github.com/guglielmo/geojson-italy',
  },
  {
    name: 'NASA POWER',
    area: 'Clima mensile dal 1991 (tendenza della temperatura)',
    license: 'Dati aperti NASA',
    limits: 'Nessuna chiave, risposte tenute in cache 30 giorni',
    url: 'https://power.larc.nasa.gov/docs/',
  },
  {
    name: 'Wikidata e Wikipedia',
    area: 'Schede informative dei comuni',
    license: 'CC0 (Wikidata), CC BY-SA (Wikipedia)',
    limits: 'Wikidata risponde «troppe richieste» con facilità: risultati in cache 7 giorni',
    url: 'https://www.wikidata.org/wiki/Wikidata:Licensing',
  },
  {
    name: 'dati.gov.it (CKAN)',
    area: 'Dataset della PA collegati a un comune',
    license: 'Dipende dal dataset',
    limits: 'Nessuna autenticazione; senza CORS, interrogato via JSONP',
    url: 'https://www.dati.gov.it/opendata/api/3/action/help_show?name=package_search',
  },
  {
    name: 'OpenStreetMap · Overpass',
    area: 'Censimento dei servizi di un comune (su richiesta)',
    license: 'ODbL, attribuzione obbligatoria',
    limits: 'Server pubblici spesso sovraccarichi: una richiesta alla volta, solo su azione dell’utente',
    url: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
  },
  {
    name: 'OpenStreetMap (tile)',
    area: 'Mappa base',
    license: 'ODbL, attribuzione obbligatoria',
    limits: 'Uso leggero: va bene per un progetto personale',
    url: 'https://operations.osmfoundation.org/policies/tiles/',
  },
  {
    name: 'Nominatim (OpenStreetMap)',
    area: 'Nome del punto cliccato sulla mappa',
    license: 'ODbL, attribuzione obbligatoria',
    limits: 'Max 1 richiesta al secondo, solo su azione dell’utente',
    url: 'https://operations.osmfoundation.org/policies/nominatim/',
  },
];
