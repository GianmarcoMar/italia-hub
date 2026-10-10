# Italia Hub

Una mappa interattiva dell'Italia, a schermo intero, che unisce API e dataset pubblici, gratuiti e senza chiave.
Si naviga dal quadro nazionale fino ai 7.896 comuni: un clic apre il dossier con statistiche, storico e situazione
in tempo reale. Niente pagine né schede: tutto sta sulla mappa. Progetto personale.

```
┌ barra: layer · cerca/comandi (Ctrl+K) · spie fonti · ora · fonti · tema ┐
│ layer e feed (sx, sopra la mappa)    MAPPA    dossier (dx, sopra la mappa) │
└──────────────────────── timeline degli eventi ─────────────────────────┘
```

## Come si usa

- **Clic sulla mappa**: il livello dipende dallo zoom. Sotto 7 apre la regione, da 7 a 9 la provincia, da 9 il
  comune. Fuori dai confini (mare, estero) apre il punto. Clic su un evento sismico apre l'evento.
- **Dossier** (✕ per chiuderlo): percorso Italia › regione › provincia › comune sempre cliccabile.
  - *Live* (ogni 10 minuti): meteo, qualità dell'aria e pollini, allerta della Protezione Civile per oggi e
    domani, terremoti vicini, mare, alba/tramonto/UV.
  - *Demografia ed economia*: ISTAT dal 2019, redditi IRPEF dal 2014, piramide delle età, confronto con
    provincia, regione e Italia, classifiche.
  - *Storico*: clima dal 1991 (NASA POWER) e terremoti dal 1985 (INGV).
  - *Territorio e info*: servizi OpenStreetMap (su richiesta), Wikipedia e Wikidata, dataset dati.gov.it.
  - Province, regioni e Italia sommano i dati dei loro comuni, con classifica interna ordinabile.
- **Coropleta**: per comune (allerta, densità, variazione della popolazione, età, stranieri, reddito), per provincia
  in tempo reale (aria, temperatura), per regione (terremoti, temperatura). Le zone d'allerta DPC sono un layer.
- **Timeline**: istogramma degli eventi; trascinando si isola un intervallo che filtra mappa ed elenchi; ▶ lo fa
  scorrere nel tempo.
- **Analisi incrociata** (pulsante «Analisi» in alto): incrocia i dati di comuni, province e regioni.
  - *Cosa emerge*: conclusioni scritte dai numeri (divario di reddito tra le aree, spopolamento dei comuni piccoli, invecchiamento, dove vivono gli stranieri, cosa si lega a cosa), ognuna con l'azione per verificarla sulla mappa o nel grafico.
  - *Esplora i dati*: dispersione di due variabili qualsiasi (7.896 comuni colorati per macro-area, clic su un punto = dossier), retta, ρ di Spearman, r di Pearson e confronto per fasce.
  - *Matrice delle correlazioni*, tabelle per macro-area e per dimensione dei comuni.
  - Fonti aggiuntive su richiesta: sismicità INGV dal 1985 (M3+), clima NASA POWER delle 20 regioni, allerte di oggi: quando arrivano si aggiungono nuove conclusioni.
  - Ogni frase nasce da un calcolo con test (`core/dashboard.spec.ts`); le correlazioni sono presentate come tali, non come cause, e con pochi dati («20 regioni») si dice che il risultato è indicativo.
- **Palette dei comandi** (Ctrl+K o `/`): comuni, province, regioni, luoghi, eventi e comandi.
- **Vista condivisibile**: posizione, zoom, filtri, finestra, coropleta ed entità selezionata sono nell'URL.
- Tema scuro di default, chiaro dal pulsante in alto. Su telefono il dossier sale dal basso e i layer sono un cassetto.

Fonti, licenze e limiti sono nella finestra «Fonti» (e in `src/app/core/sources.ts`).

## Avvio

```bash
npm install
npm start      # http://localhost:4200
npm run build
npm test       # test unitari (Vitest)
npm run data   # rigenera i dati statici dei comuni (vedi sotto)
```

Richiede Node 20.19+ / 22.12+ / 24+.

## Dati statici dei comuni

`npm run data` (`scripts/build-data.mjs`) scarica e unisce, con chiave = codice catastale:

- popolazione ISTAT POSAS 2019–2025 e struttura STRASA 2025 (CC BY 4.0);
- redditi IRPEF per comune 2014–2024 del MEF (CC BY 3.0 IT);
- confini comunali ISTAT via [geojson-italy](https://github.com/guglielmo/geojson-italy) (CC BY), semplificati con
  mapshaper (eseguito con `npx`, non è una dipendenza).

Produce `public/data/comuni.json` (~1 MB, caricato alla prima apertura di un dossier), `public/data/dettaglio/R{n}.json`
e `public/geo/comuni/R{n}.geojson` (una regione alla volta, solo quando serve).

## Struttura

- `src/app/app.*`: guscio (barra, pannelli sopra la mappa)
- `src/app/map/map-view.*`: unico componente che tocca Leaflet (confini, comuni, coropleta, allerte, meteo, eventi)
- `src/app/shell/`: pannello layer, feed, timeline, stato fonti, palette, finestra delle fonti
- `src/app/inspector/`: dossier per comune, provincia, regione, Italia, evento sismico e punto (`panels/` = sezioni)
- `src/app/core/`: `apis.service.ts` (tutte le chiamate), parser e funzioni pure con i loro `.spec.ts`
  (`parsers`, `analysis`, `census`, `alerts`, `history`), servizi di stato (selezione, azioni, località, mappa, URL)
- `src/app/shared/`: grafici SVG senza librerie

## Da sapere (verificato a ottobre 2026)

- CORS: le API usate mandano `Access-Control-Allow-Origin: *` tranne dati.gov.it (JSONP). OpenSky, adsb.lol e i prezzi
  dei carburanti MIMIT non hanno CORS: per questo voli e carburanti non ci sono.
- INGV: orari UTC senza `Z` (`parseUtc()`), `204` senza corpo se non ci sono eventi.
- Wikidata risponde 429 con facilità: risultati in cache locale per 7 giorni. I server Overpass sono spesso
  sovraccarichi: il censimento dei servizi parte solo su richiesta.
- Allerte DPC: il comune si associa alla zona per nome (12 comuni su 7.896 restano senza zona).
- Con la semplificazione dei confini la provincia indicata vicino a un confine può essere quella accanto.
