/** Codici meteo WMO usati da Open-Meteo: etichetta italiana ed emoji. */

const WMO: Record<number, [string, string]> = {
  0: ['Sereno', '☀️'],
  1: ['Prevalentemente sereno', '🌤️'],
  2: ['Parzialmente nuvoloso', '⛅'],
  3: ['Coperto', '☁️'],
  45: ['Nebbia', '🌫️'],
  48: ['Nebbia con brina', '🌫️'],
  51: ['Pioviggine leggera', '🌦️'],
  53: ['Pioviggine', '🌦️'],
  55: ['Pioviggine intensa', '🌧️'],
  56: ['Pioviggine gelata', '🌧️'],
  57: ['Pioviggine gelata intensa', '🌧️'],
  61: ['Pioggia debole', '🌦️'],
  63: ['Pioggia', '🌧️'],
  65: ['Pioggia forte', '🌧️'],
  66: ['Pioggia gelata', '🌧️'],
  67: ['Pioggia gelata forte', '🌧️'],
  71: ['Neve debole', '🌨️'],
  73: ['Neve', '🌨️'],
  75: ['Neve forte', '❄️'],
  77: ['Granelli di neve', '🌨️'],
  80: ['Rovesci deboli', '🌦️'],
  81: ['Rovesci', '🌧️'],
  82: ['Rovesci violenti', '⛈️'],
  85: ['Rovesci di neve', '🌨️'],
  86: ['Rovesci di neve forti', '❄️'],
  95: ['Temporale', '⛈️'],
  96: ['Temporale con grandine', '⛈️'],
  99: ['Temporale forte con grandine', '⛈️'],
};

export const weatherLabel = (code: number) => WMO[code]?.[0] ?? `Codice ${code}`;
export const weatherIcon = (code: number) => WMO[code]?.[1] ?? '🌡️';
