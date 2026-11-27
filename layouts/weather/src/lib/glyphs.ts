// Line icons on a 24-unit grid, drawn with a round stroke and no fill, like the
// morning and news glyphs. Names match the `icon` values in weather.mjs.
const cloudTop = 'M6 14h12a3 3 0 0 0 .2-6A6 6 0 0 0 7 8a3 3 0 0 0-1 6Z';
const smallCloud = 'M10 20h8a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.4-1 3.8 3.8 0 0 0 1 8Z';
export const glyphs: Record<string, string> = {
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z',
  partly: smallCloud + 'M7.9 12A3.2 3.2 0 1 1 12 7.9M3 9h1.4M9 3v1.4M4.8 4.8l1 1M13.2 4.8l-1 1M4.8 13.2l1-1',
  'partly-night': smallCloud + 'M10.6 10.4A4.2 4.2 0 0 1 5.6 3.6a4.4 4.4 0 1 0 5 6.8Z',
  cloud: 'M6 18h12a4 4 0 0 0 .3-8A6.5 6.5 0 0 0 6 9a4.5 4.5 0 0 0 0 9Z',
  fog: 'M6.5 10a5.5 5.5 0 0 1 11 0M3 13.5h18M5 17h14M8 20.5h8',
  drizzle: cloudTop + 'M8 18v.5M12 18v.5M16 18v.5M10 21.2v.5M14 21.2v.5',
  rain: cloudTop + 'M8 17l-1 3M13 17l-1 3M18 17l-1 3',
  sleet: cloudTop + 'M8 17l-1 3M17 17l-1 3M12.5 16.5v4.6M10.5 17.6l4 2.4M14.5 17.6l-4 2.4',
  snow: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3',
  storm: 'M6 13h12a3 3 0 0 0 .2-6A6 6 0 0 0 7 7a3 3 0 0 0-1 6ZM12 12l-3 6h4l-1 5 5-8h-4l2-3',
  sunrise: 'M3 20h18M7 20a5 5 0 0 1 10 0M12 3.5v7M9 6.5l3-3 3 3',
  sunset: 'M3 20h18M7 20a5 5 0 0 1 10 0M12 3.5v7M9 7.5l3 3 3-3',
  drop: 'M12 3S6 10 6 14.5a6 6 0 0 0 12 0C18 10 12 3 12 3Z',
  high: 'M12 20V4M6 10l6-6 6 6',
  low: 'M12 4v16M6 14l6 6 6-6',
};
export const glyph = (name: string) => glyphs[name] ?? glyphs.cloud;
