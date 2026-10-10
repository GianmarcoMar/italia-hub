/** Formattazioni condivise da mappa e pannelli. */

const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

/** "3 ore fa", "ieri", "5 giorni fa". */
export function ago(ms: number, now = Date.now()): string {
  const s = (ms - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return 'adesso';
}

/** Colore dei terremoti per profondità: superficiali più caldi. */
export function depthColor(km: number | null): string {
  if (km === null) return '#8a8f98';
  if (km < 15) return '#e4572e';
  if (km < 60) return '#e09412';
  if (km < 200) return '#7b5ea7';
  return '#3c4f9a';
}

export const DEPTH_LEGEND = [
  { label: '< 15 km', color: depthColor(0) },
  { label: '15–60', color: depthColor(20) },
  { label: '60–200', color: depthColor(100) },
  { label: '> 200', color: depthColor(300) },
];
