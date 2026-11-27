export const glyphs = {
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  cloud: 'M6 18h12a4 4 0 0 0 .3-8A6.5 6.5 0 0 0 6 9a4.5 4.5 0 0 0 0 9Z',
  rain: 'M6 14h12a3 3 0 0 0 .2-6A6 6 0 0 0 7 8a3 3 0 0 0-1 6ZM8 17l-1 3M13 17l-1 3M18 17l-1 3',
  humidity: 'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM9 15a3 3 0 0 0 3 3',
  sunset: 'M2 18h20M5 15a7 7 0 0 1 14 0M12 3v3M3 7l2 2M21 7l-2 2M12 11v6M9 14l3 3 3-3',
  high: 'M12 20V4M6 10l6-6 6 6',
  low: 'M12 4v16M6 14l6 6 6-6',
  snow: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3',
  storm: 'M6 13h12a3 3 0 0 0 .2-6A6 6 0 0 0 7 7a3 3 0 0 0-1 6ZM12 12l-3 6h4l-1 5 5-8h-4l2-3',
};
export function weatherGlyph(label: string) {
  const key = /thunder/i.test(label) ? 'storm' : /snow/i.test(label) ? 'snow' : /rain|showers/i.test(label) ? 'rain' : /clear/i.test(label) ? 'sun' : /cloud|overcast|fog/i.test(label) ? 'cloud' : null;
  return key ? glyphs[key] : '';
}
