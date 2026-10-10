// Prepara i dati statici sui comuni italiani, inclusi nell'app in public/.
//
//   npm run data            (scarica in node_modules/.cache/italia-hub-data, ~120 MB)
//
// Fonti (tutte libere):
//   - Confini comunali ISTAT 1/1/2026 via github.com/guglielmo/geojson-italy (CC BY 4.0)
//   - Popolazione per età e sesso al 1/1/2025 e 1/1/2020, ISTAT demo.istat.it POSAS (CC BY 4.0)
//   - Popolazione straniera al 1/1/2025, ISTAT STRASA (CC BY 4.0)
//   - Redditi IRPEF per comune, anni d'imposta 2024, 2019, 2014, MEF Dipartimento Finanze (CC BY 3.0 IT)
//
// Chiave di tutto è il codice catastale (Belfiore): stabile anche quando cambiano i codici ISTAT
// (es. il riordino delle province sarde del 2026).
//
// I file scaricati sono trattati solo come dati: si leggono numeri e codici, nulla viene eseguito.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const CACHE = process.argv[2] ?? 'node_modules/.cache/italia-hub-data';
const OUT_GEO = 'public/geo/comuni';
const OUT_DATA = 'public/data';
const MAPSHAPER = 'mapshaper@0.6.102';
/**
 * Semplificazione dei confini comunali (frazione di punti tenuti): compromesso tra dettaglio e peso.
 * Niente "%" né spazi negli argomenti: su Windows npx passa da cmd, che li interpreterebbe.
 */
const SIMPLIFY = '0.07';

/** Anni delle serie storiche: popolazione al 1° gennaio (ISTAT POSAS) e redditi per anno d'imposta (MEF). */
const POP_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const INCOME_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

const SRC = {
  posas: y => `https://demo.istat.it/data/posas/POSAS_${y}_it_Comuni.zip`,
  strasa: y => `https://demo.istat.it/data/strasa/STRASA_${y}_it_Comuni.zip`,
  mef: y =>
    `https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/Redditi_e_principali_variabili_IRPEF_su_base_comunale_CSV_${y}.zip`,
  // jsDelivr rifiuta i file troppo grandi (403): si ripiega su raw.githubusercontent.com
  comuni: r => [
    `https://cdn.jsdelivr.net/gh/guglielmo/geojson-italy@main/geojson/limits_R_${r}_municipalities.geojson`,
    `https://raw.githubusercontent.com/guglielmo/geojson-italy/main/geojson/limits_R_${r}_municipalities.geojson`,
  ],
};

// ---------- utilità ----------

/** Scarica (una volta sola, poi dalla cache) provando gli indirizzi in ordine. */
async function download(urls, name) {
  const file = join(CACHE, name);
  if (existsSync(file)) return readFile(file);
  let last;
  for (const url of [urls].flat()) {
    console.log('↓', url);
    const res = await fetch(url, { headers: { 'User-Agent': 'italia-hub-data-build (progetto personale)' } });
    if (!res.ok) {
      last = new Error(`${res.status} ${url}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(file, buf);
    return buf;
  }
  throw last;
}

/** Primo CSV dentro uno zip, come testo. */
function csvFromZip(buf, encoding = 'utf-8') {
  const files = unzipSync(new Uint8Array(buf), { filter: f => f.name.toLowerCase().endsWith('.csv') });
  const [first] = Object.values(files);
  if (!first) throw new Error('nessun CSV nello zip');
  return new TextDecoder(encoding).decode(first);
}

/** Righe di un CSV con separatore ";" e virgolette semplici (nessun ";" dentro i campi in queste fonti). */
function rows(text) {
  return text
    .split(/\r?\n/)
    .filter(l => l.trim())
    .map(l => l.split(';').map(c => c.replace(/^"|"$/g, '').trim()));
}

const num = s => {
  const v = Number(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- MEF: redditi ----------

/**
 * Per ogni comune (codice catastale): contribuenti, reddito medio (somma delle fasce di reddito complessivo,
 * ammontare / frequenza: le stesse colonne esistono in tutti gli anni), fasce e composizione.
 * Restituisce anche la mappa codice ISTAT dell'epoca → catastale.
 */
function parseMef(text) {
  const [head, ...data] = rows(text);
  const col = re => head.findIndex(h => re.test(h));
  const iCat = col(/^Codice catastale/i);
  const iIstat = col(/^Codice Istat Comune/i);
  const iTax = col(/^Numero contribuenti/i);
  const bands = head
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^Reddito complessivo (minore|da |oltre)/i.test(h));
  const bandFreq = bands.filter(b => /Frequenza/i.test(b.h)).map(b => b.i);
  const bandAmt = bands.filter(b => /Ammontare/i.test(b.h)).map(b => b.i);
  const comp = {
    dip: col(/^Reddito da lavoro dipendente.*Ammontare/i),
    pen: col(/^Reddito da pensione.*Ammontare/i),
    aut: col(/^Reddito da lavoro autonomo.*Ammontare/i),
  };
  if (iCat < 0 || bandFreq.length < 8) throw new Error('formato MEF inatteso');

  const out = new Map();
  const istatToCat = new Map();
  for (const r of data) {
    const cat = r[iCat];
    if (!/^[A-Z]\d{3}$/.test(cat)) continue;
    const freq = bandFreq.map(i => num(r[i]));
    const amt = bandAmt.map(i => num(r[i]));
    const f = freq.reduce((a, b) => a + b, 0);
    const a = amt.reduce((x, y) => x + y, 0);
    istatToCat.set(r[iIstat], cat);
    out.set(cat, {
      tax: num(r[iTax]),
      inc: f ? Math.round(a / f) : null,
      // le prime due fasce (≤0 e 0-10k) unite: 7 fasce
      bandsF: [freq[0] + freq[1], ...freq.slice(2)],
      comp: { dip: num(r[comp.dip]), pen: num(r[comp.pen]), aut: num(r[comp.aut]), tot: a },
    });
  }
  return { byCat: out, istatToCat };
}

// ---------- ISTAT: popolazione ----------

const BANDS = 21; // 0-4, 5-9, ..., 95-99, 100+

/** Popolazione per comune (codice ISTAT dell'epoca): totali, età media, quote e piramide a fasce di 5 anni. */
function parsePosas(text) {
  const [, head, ...data] = rows(text); // la prima riga è il titolo
  const iCode = 0;
  const iAge = 2;
  const iM = head.findIndex(h => /^Totale maschi/i.test(h));
  const iF = head.findIndex(h => /^Totale femmine/i.test(h));
  const iMarM = head.findIndex(h => /^Coniugati$/i.test(h));
  const iMarF = head.findIndex(h => /^Coniugate$/i.test(h));
  const out = new Map();
  for (const r of data) {
    const code = r[iCode];
    if (!/^\d{6}$/.test(code)) continue;
    const age = num(r[iAge]);
    if (age === 999) continue; // riga dei totali: si ricalcola dalle età
    const m = num(r[iM]);
    const f = num(r[iF]);
    let c = out.get(code);
    if (!c) out.set(code, (c = { m: 0, f: 0, ageSum: 0, y14: 0, o65: 0, married: 0, bm: Array(BANDS).fill(0), bf: Array(BANDS).fill(0) }));
    c.m += m;
    c.f += f;
    c.ageSum += age * (m + f);
    if (age <= 14) c.y14 += m + f;
    if (age >= 65) c.o65 += m + f;
    c.married += num(r[iMarM]) + num(r[iMarF]);
    const b = Math.min(BANDS - 1, Math.floor(age / 5));
    c.bm[b] += m;
    c.bf[b] += f;
  }
  return out;
}

/** Stranieri residenti per comune: somma di tutte le età e dei due sessi. */
function parseStrasa(text) {
  const [, , ...data] = rows(text);
  const out = new Map();
  for (const r of data) {
    if (!/^\d{6}$/.test(r[0]) || num(r[2]) === 999) continue;
    out.set(r[0], (out.get(r[0]) ?? 0) + num(r[3]) + num(r[4]));
  }
  return out;
}

// ---------- confini ----------

/** Semplifica i confini di una regione con mapshaper, calcolando prima superficie e punto interno. */
function simplifyRegion(input, output) {
  const each = 'a=Math.round(this.area/1e4)/100,x=Math.round(this.innerX*1e4)/1e4,y=Math.round(this.innerY*1e4)/1e4';
  const args = [
    '-y', MAPSHAPER,
    input,
    '-each', each,
    '-simplify', SIMPLIFY, 'keep-shapes',
    '-rename-fields', 'n=name,k=com_catasto_code,i=com_istat_code,p=prov_istat_code_num,s=prov_acr',
    '-filter-fields', 'n,k,i,p,s,a,x,y',
    '-o', 'precision=0.0001', 'format=geojson', output,
  ];
  // riga di comando costruita qui, con ogni argomento tra virgolette (nessuno contiene virgolette)
  const cmd = ['npx', ...args.map(a => `"${a}"`)].join(' ');
  const r = spawnSync(cmd, { shell: true, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`mapshaper fallito su ${input}`);
}

// ---------- main ----------

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_GEO, { recursive: true });
  await mkdir(join(OUT_DATA, 'dettaglio'), { recursive: true });

  // redditi: un file per anno d'imposta
  const mef = new Map();
  for (const y of INCOME_YEARS) mef.set(y, parseMef(csvFromZip(await download(SRC.mef(y), `mef${y}.zip`), 'latin1')));
  const mef24 = mef.get(2024);

  // codici ISTAT dell'epoca → catastale (i file ISTAT non hanno il catastale; il MEF sì).
  // Per l'anno y si usa la mappa del MEF più vicino, poi le altre come riserva.
  const toCatFor = y => {
    const near = Math.min(Math.max(y - 1, INCOME_YEARS[0]), 2024);
    return new Map([...INCOME_YEARS.map(z => [...mef.get(z).istatToCat]).flat(), ...mef.get(near).istatToCat]);
  };
  const byCat = (map, toCat) => {
    const out = new Map();
    for (const [code, v] of map) {
      const cat = toCat.get(code);
      if (cat) out.set(cat, v);
    }
    return out;
  };

  // popolazione: dettaglio completo per il 2025 e il 2020, solo totali per gli altri anni
  const popYears = new Map();
  for (const y of POP_YEARS) {
    popYears.set(y, byCat(parsePosas(csvFromZip(await download(SRC.posas(y), `posas${y}.zip`))), toCatFor(y)));
  }
  const pop25 = popYears.get(2025);
  const pop20 = popYears.get(2020);
  const foreign = byCat(parseStrasa(csvFromZip(await download(SRC.strasa(2025), 'strasa2025.zip'))), toCatFor(2025));

  const fields = [
    'name', 'istat', 'prov', 'provAcr', 'reg', 'area', 'x', 'y',
    'pop', 'pop20', 'male', 'female', 'ageMean', 'pct0_14', 'pct65', 'pctMarried', 'foreign',
    'taxpayers', 'inc', 'inc19', 'inc14',
  ];
  const all = {};
  let missingPop = 0;

  for (let reg = 1; reg <= 20; reg++) {
    const raw = join(CACHE, `R${reg}.geojson`);
    await download(SRC.comuni(reg), `R${reg}.geojson`);
    const out = join(OUT_GEO, `R${reg}.geojson`);
    simplifyRegion(raw, out);

    const geo = JSON.parse(await readFile(out, 'utf-8'));
    const detail = {};
    for (const f of geo.features) {
      const p = f.properties;
      const k = p.k;
      const d = pop25.get(k);
      const old = pop20.get(k);
      const m = mef24.byCat.get(k);
      const pop = d ? d.m + d.f : null;
      if (!d) missingPop++;
      all[k] = [
        p.n, p.i, p.p, p.s, reg, p.a, p.x, p.y,
        pop, old ? old.m + old.f : null, d?.m ?? null, d?.f ?? null,
        d && pop ? round(d.ageSum / pop + 0.5) : null, // età in anni compiuti: +0,5 per l'età media
        d && pop ? round((d.y14 / pop) * 100) : null,
        d && pop ? round((d.o65 / pop) * 100) : null,
        d && pop ? round((d.married / pop) * 100) : null,
        foreign.get(k) ?? null,
        m?.tax ?? null, m?.inc ?? null, mef.get(2019).byCat.get(k)?.inc ?? null, mef.get(2014).byCat.get(k)?.inc ?? null,
      ];
      detail[k] = {
        ...(d ? { bm: d.bm, bf: d.bf } : {}),
        ...(m ? { ib: m.bandsF, comp: [m.comp.dip, m.comp.pen, m.comp.aut, m.comp.tot] } : {}),
        // serie storiche: popolazione al 1° gennaio e reddito medio per anno d'imposta
        ps: POP_YEARS.map(y => {
          const v = popYears.get(y).get(k);
          return v ? v.m + v.f : null;
        }),
        is: INCOME_YEARS.map(y => mef.get(y).byCat.get(k)?.inc ?? null),
      };
    }
    await writeFile(join(OUT_DATA, 'dettaglio', `R${reg}.json`), JSON.stringify(detail));
    console.log(`R${reg}: ${geo.features.length} comuni`);
  }

  const meta = {
    generated: new Date().toISOString().slice(0, 10),
    popYears: POP_YEARS,
    incomeYears: INCOME_YEARS,
    sources: {
      confini: 'ISTAT 1/1/2026 via geojson-italy (CC BY 4.0)',
      popolazione: 'ISTAT POSAS 1/1/2025 e 1/1/2020 (CC BY 4.0)',
      stranieri: 'ISTAT STRASA 1/1/2025 (CC BY 4.0)',
      popolazione_serie: 'ISTAT POSAS 1/1/2019 – 1/1/2025 (CC BY 4.0)',
      redditi: "MEF Dipartimento Finanze, IRPEF anni d'imposta 2014 – 2024 (CC BY 3.0 IT)",
    },
    fields,
  };
  await writeFile(join(OUT_DATA, 'comuni.json'), JSON.stringify({ ...meta, rows: all }));
  console.log(`comuni: ${Object.keys(all).length}, senza popolazione: ${missingPop}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
