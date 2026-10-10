/**
 * Bollettini di criticità idrogeologica e idraulica della Protezione Civile (DPC, CC BY 4.0),
 * da github.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica.
 * Ogni zona d'allerta elenca i propri comuni: l'allerta di un comune si trova per nome.
 * Funzioni pure, testate in alerts.spec.ts.
 */
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { containsPoint } from './parsers';

/** 0 nessuna, 1 gialla, 2 arancione, 3 rossa */
export type AlertLevel = 0 | 1 | 2 | 3;

export const ALERT_LABEL = ['Nessuna allerta', 'Allerta gialla', 'Allerta arancione', 'Allerta rossa'] as const;
export const ALERT_COLOR = ['#2e7d32', '#f2c200', '#f57c00', '#d32f2f'] as const;

export interface AlertZone {
  name: string;
  level: AlertLevel;
  /** testo del rischio rappresentato in mappa, es. "Moderata per rischio temporali / ALLERTA ARANCIONE" */
  summary: string;
  risks: { idraulico: AlertLevel; temporali: AlertLevel; idrogeologico: AlertLevel };
  comuni: string[];
  geometry: { type: string; coordinates: any } | null;
}

/** Livello da un testo del bollettino ("… / ALLERTA ARANCIONE"). */
export function alertLevel(s: string | undefined | null): AlertLevel {
  const t = (s ?? '').toUpperCase();
  if (t.includes('ROSSA')) return 3;
  if (t.includes('ARANCIONE')) return 2;
  if (t.includes('GIALLA')) return 1;
  return 0;
}

/**
 * Difesa contro testi UTF-8 riletti come Latin-1 ("CittÃ  Sant'Angelo"). I bollettini verificati sono
 * corretti, ma un passaggio intermedio può rovinarli. "à" diventa "Ã" + 0xA0, che spesso arriva come spazio.
 */
export function fixMojibake(s: string): string {
  if (!/[ÃÂ]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s.replace(/Ã /g, 'Ã ')].map(ch => ch.charCodeAt(0) & 0xff));
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return fixed;
  } catch {
    return s;
  }
}

/** Nome normalizzato per il confronto: minuscole, senza accenti, apostrofi e trattini come spazi. */
export function normName(s: string): string {
  return fixMojibake(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`\-/.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Id del bollettino più recente tra nomi di file come "files/preview/20261008_1521_oggi.png". */
export function latestBulletinId(names: string[]): string | null {
  const ids = names.map(n => /(\d{8}_\d{4})/.exec(n)?.[1]).filter((x): x is string => !!x);
  return ids.length ? ids.sort().at(-1)! : null;
}

/** Zone d'allerta dal topojson del giorno. */
export function zonesFromTopo(topo: Topology): AlertZone[] {
  const key = Object.keys(topo.objects)[0];
  if (!key) return [];
  const fc = feature(topo, topo.objects[key]) as unknown as { features: { properties: any; geometry: any }[] };
  return fc.features.map(f => {
    const p = f.properties ?? {};
    return {
      name: fixMojibake(String(p['Nome zona'] ?? '')),
      level: alertLevel(p['Rappresentata nella mappa']),
      summary: fixMojibake(String(p['Rappresentata nella mappa'] ?? '')),
      risks: {
        idraulico: alertLevel(p['Per rischio idraulico']),
        temporali: alertLevel(p['Per rischio temporali']),
        idrogeologico: alertLevel(p['Per rischio idrogeologico']),
      },
      comuni: Array.isArray(p['Comuni']) ? p['Comuni'].map((c: unknown) => fixMojibake(String(c))) : [],
      geometry: f.geometry ?? null,
    };
  });
}

/** Indice nome normalizzato → zone che contengono un comune con quel nome. */
export function indexZones(zones: AlertZone[]): Map<string, AlertZone[]> {
  const idx = new Map<string, AlertZone[]>();
  for (const z of zones) {
    for (const c of z.comuni) {
      const k = normName(c);
      const arr = idx.get(k);
      if (arr) arr.push(z);
      else idx.set(k, [z]);
    }
  }
  return idx;
}

/**
 * Zona d'allerta di un comune. Per gli omonimi in regioni diverse (es. "Castro") vince la zona
 * che contiene il punto del comune.
 */
export function zoneFor(idx: Map<string, AlertZone[]>, name: string, lat: number, lon: number): AlertZone | null {
  // nomi bilingui ISTAT ("Appiano sulla strada del vino/Eppan …") o doppi ("Tripi - Abakainon"):
  // il bollettino usa di solito la prima parte
  const variants = [name, name.split('/')[0], name.split(' - ')[0]];
  const list = variants.map(v => idx.get(normName(v))).find(l => l?.length) ?? [];
  if (list.length <= 1) return list[0] ?? null;
  return list.find(z => containsPoint(z.geometry, lat, lon)) ?? list[0];
}

/** Testo leggibile dalla descrizione HTML del bollettino (mai inserita come HTML). */
export function bulletinText(html: string): string[] {
  return fixMojibake(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}
