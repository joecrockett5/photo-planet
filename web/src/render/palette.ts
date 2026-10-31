/**
 * The one limited palette shared by sky, planet, pins and UI. Every pixel drawn
 * on the canvas is one of these. CSS gets the same colours as custom properties.
 */
export const HEX = {
  // space
  space: '#0d0b1e',
  nebula1: '#141130',
  nebula2: '#1c1642',
  // stars
  starDim: '#3b3d75',
  starMid: '#7f87c6',
  starBright: '#eef0ff',
  starWarm: '#ffd69a',
  starCool: '#9ed3ff',
  // ocean
  oceanNight: '#0f1736',
  oceanDark: '#152a5c',
  ocean: '#1c4087',
  shallowDark: '#1f5598',
  shallow: '#2b78bb',
  // land
  landNight: '#1a2138',
  beach: '#e3d29a',
  grassDark: '#3c7d3d',
  grass: '#62ad4f',
  forestDark: '#184a36',
  forest: '#28704a',
  desertDark: '#b08654',
  desert: '#e0bf78',
  rockDark: '#5c5650',
  rock: '#8e8476',
  iceDark: '#9fb1d6',
  ice: '#f1f5ff',
  iceNight: '#2b3557',
  // atmosphere
  atmoDim: '#2f4fa8',
  atmo: '#79c8ff',
  // pins and accents
  pin: '#ff5d6c',
  pinDark: '#a52c4c',
  pinLight: '#fff1c4',
} as const;

export type ColorName = keyof typeof HEX;

/** Pack a hex colour as a little-endian RGBA uint32 for ImageData buffers. */
function pack(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export const C = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, pack(v)])) as Record<ColorName, number>;

/** Expose the palette to CSS as --c-<name>. */
export function applyPaletteToCss(root: HTMLElement = document.documentElement): void {
  for (const [name, hex] of Object.entries(HEX)) root.style.setProperty(`--c-${name}`, hex);
}
