/**
 * Parse the ISO 6709 point strings phones put in video metadata, e.g.
 * `+51.5074-000.1278+011.000/` (iPhone) or `+48.8584+002.2945/` (Android).
 * Also accepts the degrees+minutes(+seconds) forms (`+4030.5-07400.0/`,
 * `+403000-0740000/`). Returns null if it doesn't look like a valid point.
 */
export function parseIso6709(value: string | undefined | null): { lat: number; lon: number } | null {
  if (!value) return null;
  const m = /^\s*([+-])(\d+)(\.\d+)?([+-])(\d+)(\.\d+)?/.exec(value);
  if (!m) return null;
  const lat = component(m[1]!, m[2]!, m[3], 2);
  const lon = component(m[4]!, m[5]!, m[6], 3);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** `degDigits` is 2 for latitude, 3 for longitude. */
function component(sign: string, int: string, frac: string | undefined, degDigits: number): number | null {
  const fraction = frac ? Number(frac) : 0;
  let value: number;
  if (int.length <= degDigits) {
    value = Number(int) + fraction; // ±DD.DDD
  } else if (int.length === degDigits + 2) {
    value = Number(int.slice(0, degDigits)) + (Number(int.slice(degDigits)) + fraction) / 60; // ±DDMM.MMM
  } else if (int.length === degDigits + 4) {
    const d = Number(int.slice(0, degDigits));
    const mm = Number(int.slice(degDigits, degDigits + 2));
    const ss = Number(int.slice(degDigits + 2)) + fraction;
    value = d + mm / 60 + ss / 3600; // ±DDMMSS.SSS
  } else {
    return null;
  }
  return Number.isFinite(value) ? (sign === '-' ? -value : value) : null;
}
