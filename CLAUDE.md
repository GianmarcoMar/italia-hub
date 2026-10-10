# Italia Hub

App Angular 21 (standalone, signals, zoneless) che unisce API pubbliche, gratuite e senza chiave. Progetto personale, non commerciale.

Una sola schermata, niente router né schede: la mappa riempie la finestra e i pannelli (barra, layer + feed a sinistra, dossier a destra, timeline in basso) fluttuano sopra. Su mobile il dossier è un foglio dal basso e i layer un cassetto. Palette dei comandi con Ctrl+K. Tema scuro di default. Le posizioni dei pannelli sono in `app.css`; `MapService.insets()` sposta `flyTo`/`fitBox` nell'area libera e `--right-inset`/`--bottom-inset` spostano zoom e attribuzione di Leaflet.

Modello a entità (`SelectionService`): `italy`, `region`, `province`, `comune`, `quake`, `place` (punto senza comune: mare o estero). `closePanel()` nasconde il dossier finché la selezione non cambia (`panelOpen`). Un clic su un punto va in `ActionsService.focusPoint` (comune che lo contiene, altrimenti `place`). L'evento sotto il puntatore (`hoveredQuake`) si evidenzia in mappa, elenchi, feed e timeline. La finestra della timeline (`QuakeStore.window`) filtra `QuakeStore.visible`, che usano mappa, elenchi e analisi.

Livelli territoriali: clic su zoom < 7 = regione, 7–9 = provincia, ≥ 9 = comune (dossier in `inspector/comune-entity.ts`). Dati statici sui 7.896 comuni in `public/data` e `public/geo/comuni`, generati con `npm run data` (`scripts/build-data.mjs`, ISTAT POSAS/STRASA, MEF IRPEF, confini geojson-italy; chiave = codice catastale). Tempo reale: Open-Meteo (meteo, aria, mare), DPC allerte (`core/alerts*.ts`, comune ↔ zona per nome), INGV. Storico: NASA POWER (clima dal 1991), INGV dal 1985. Wikidata ha limiti stretti (429): risultati in cache locale.

## Comandi

- `npm install`, poi `npm start` (localhost:4200)
- `npm run build` per la build di produzione
- `npm test` per i test unitari (Vitest, builder `@angular/build:unit-test`)
- Node 20.19+ / 22.12+ / 24+

## Struttura

- `src/app/app.*`: guscio. Palette, finestra delle fonti, feed e timeline sono in `@defer (on idle)` per stare nel budget del bundle iniziale
- `src/app/shell/*`: status (spie fonti + orologio), layers-panel, feed, timeline (brush + replay), command-palette (aperta via `PaletteService`), sources-dialog (aperta via `UiService.sourcesOpen`)
- `src/app/inspector/*`: inspector (percorso + entità in `@defer`), un componente per entità (comune, provincia, regione, italia, quake, place) e `panels/`
- `src/app/map/map-view.*`: unico componente che tocca Leaflet. CSS senza incapsulamento (gli elementi creati da Leaflet non hanno gli attributi Angular), ogni regola parte da `app-map`. I marker dei terremoti si creano una volta per elenco; la finestra temporale li aggiunge/toglie dal layer (il replay resta fluido). Negli `effect` leggere le dipendenze prima di ogni `return` anticipato
- `src/app/core/analysis.ts`: funzioni pure per timeline, relazioni, aggregazioni per regione, allerte meteo, classi della coropleta, stato nell'URL (test in `analysis.spec.ts`)
- `src/app/core/actions.service.ts`: azioni condivise (focusQuake, focusRegion, focusProvince, focusComune, focusPoint, goPlace, goCapital, goProvince)
- `src/app/core/url-state.service.ts`: query param `lat lon z t0 t1 src d m ch sel` (solo i valori diversi dal default), letti all'avvio prima della mappa e riscritti con `history.replaceState`
- `src/app/core/apis.service.ts`: tutte le chiamate HTTP alle API (unico punto da toccare per cambiare endpoint)
- `src/app/core/parsers.ts`: modelli, conversione delle risposte e geometria (funzioni pure, test in `parsers.spec.ts`)
- `src/app/core/location.service.ts`: località selezionata (signal + localStorage), `coords` (cambia solo con le coordinate), `region`/`province` calcolate dai confini
- `src/app/core/geo.service.ts`: confini ISTAT da `public/geo/*.geojson` (semplificati al 4%), `regionAt`/`provinceAt`
- `src/app/core/stores.ts`: risorse root condivise (ForecastStore, CapitalsWeatherStore con polling 15 min, QuakeStore con polling 2 min e finestra, AnalysisStore per la coropleta)
- `src/app/core/map.service.ts`: i pannelli comandano la mappa (flyTo, fitBox, layer visibili, coropleta, zoom)
- `src/app/core/sources.ts`: elenco fonti con licenza e limiti, mostrato nella finestra Fonti
- `src/app/shared/`: grafici SVG (line-chart con hover, bar-chart, pyramid, rel-graph). Colori passati come stile, così funzionano le `var()`
- Mappa: Leaflet con tile OpenStreetMap (attribuzione obbligatoria, solo uso leggero). Tema scuro: tile invertite via CSS
- Tema: token in `styles.css`, scuro su `:root`, chiaro su `:root[data-theme='light']` (ThemeService). Numeri, ID e coordinate in `var(--mono)`

## API usate e vincoli

- Open-Meteo: dati CC BY 4.0, gratis solo non commerciale, meno di 10.000 chiamate al giorno
- INGV e USGS: servizi FDSN `event`, formato geojson. Filtro distanza lato server (`latitude`, `longitude`, `maxradiuskm`)
- dati.gov.it: API CKAN `package_search` su `/opendata/api/3/...` (JSONP)
- USGS: pubblico dominio, credito richiesto ("U.S. Geological Survey")
- Nominatim (reverse geocoding OSM): max 1 richiesta/s, solo su azione dell'utente (debounce 400 ms in LocationService). In mare risponde con il paese: scartato in `toReversePlace`
- Confini ISTAT: CC BY 4.0 via github.com/guglielmo/geojson-italy (vintage 1/1/2026), attribuzione nella mappa
- Open-Meteo multi-punto: `latitude=a,b,c` risponde con un array (meteo dei 20 capoluoghi in una chiamata)

## Verificato contro le API vere (ottobre 2026)

- CORS `*` su Open-Meteo, INGV, USGS, NASA POWER, Wikidata/Wikipedia, DPC (raw GitHub). dati.gov.it NON ha CORS: si usa JSONP (`callback`), quindi niente proxy per ora
- INGV: geojson ok, campi `mag`, `place`, `time`, `eventId`. `time` è UTC senza `Z` (gestito da `parseUtc`). Senza risultati risponde 204 con corpo vuoto. Il catalogo contiene anche eventi mondiali: senza filtro distanza si usa il riquadro dell'Italia
- Senza CORS (scartati): OpenSky, adsb.lol, prezzi carburanti MIMIT

## Cose ancora da verificare

1. Licenza esatta dei dati INGV (la pagina dei webservice non rispondeva).
2. Il bollettino DPC si associa ai comuni per nome: 12 su 7.896 restano senza zona.

## Idee per i prossimi passi

- Indicatori ISTAT aggiuntivi per comune (SDMX, CC BY 4.0): istruzione, imprese, turismo
- Dossier: previsioni a 7 giorni e grafico a 24 h (c'erano nella vecchia scheda Meteo)
- Rischio frane e alluvioni ISPRA IdroGEO (WMS/WFS) come layer Leaflet
- Cartografia catastale dell'Agenzia delle Entrate (WMS, CC BY 4.0)
- Backend .NET come proxy e cache (utile per sostituire il JSONP di dati.gov.it e per voli e carburanti, oggi bloccati dal CORS)

## Convenzioni

- Testi dell'interfaccia in italiano
- Signals al posto di stato mutabile; template con control flow `@if` / `@for`
- Caricamento dati con `rxResource` (niente `subscribe` manuali negli `effect`). `value()` lancia in stato di errore: controllare prima `error()` o usare `hasValue()`
- Lingua `it` registrata in `app.config.ts` (`LOCALE_ID`): non passare `'it'` alle pipe
- Mai HTML costruito da dati delle API (es. popup Leaflet): usare nodi DOM con `textContent`. Le `divIcon` contengono solo dati statici e numeri
- Colori e superfici solo dai token in `styles.css` (tema chiaro e scuro); niente emoji di bandiere (su Windows non si vedono)
- `DatePipe` non accetta fusi IANA (`Europe/Rome`): per l'ora di Roma usare `Intl.DateTimeFormat`
- In sviluppo, l'hot reload di `map-view.ts` può lasciare la mappa vuota: ricaricare la pagina
- Test nel browser: lo scroll simulato dello strumento genera un clic, che sulla mappa cambia la selezione. Scorrere con `window.scrollTo`
- Solo fonti libere e gratuite: non aggiungere API a pagamento o con licenza poco chiara
