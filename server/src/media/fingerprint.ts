import sharp from 'sharp';

/**
 * What a picture looks like, small enough to compare thousands at once.
 * Made from the thumbnail (so HEIC, videos and old items all work the same
 * way), and robust to what messaging apps do to photos: resizing,
 * recompression and stripped metadata.
 */
export interface Fingerprint {
  /**
   * 64-bit DCT perceptual hash of the greyscale image, as 16 hex digits; empty
   * for a nearly flat image (a black frame, a plain sky), whose hash is noise:
   * those are never matched.
   */
  phash: string;
  /** 4×4 average RGB, as 96 hex digits. Catches pairs with the same shapes but different colours (a B&W edit). */
  color: string;
}

const N = 32; // DCT input size
const K = 8; // low-frequency block kept
/** Below this spread of grey levels (standard deviation, 0–255) an image is too flat to hash. Real photos measured 25+. */
const MIN_CONTRAST = 8;

// cos((2x+1)uπ / 2N), precomputed for the K lowest frequencies.
const COS: Float64Array[] = Array.from({ length: K }, (_, u) => {
  const row = new Float64Array(N);
  for (let x = 0; x < N; x++) row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  return row;
});

export async function fingerprint(image: string | Buffer): Promise<Fingerprint> {
  const [grey, rgb] = await Promise.all([
    sharp(image).greyscale().resize(N, N, { fit: 'fill' }).raw().toBuffer(),
    sharp(image).removeAlpha().resize(4, 4, { fit: 'fill' }).toColourspace('srgb').raw().toBuffer(),
  ]);
  return { phash: contrast(grey) < MIN_CONTRAST ? '' : phashOf(grey), color: rgb.subarray(0, 48).toString('hex') };
}

function contrast(pixels: Uint8Array): number {
  let sum = 0;
  let sq = 0;
  for (const p of pixels) {
    sum += p;
    sq += p * p;
  }
  const mean = sum / pixels.length;
  return Math.sqrt(Math.max(0, sq / pixels.length - mean * mean));
}

/** pHash of an N×N greyscale image: the K×K lowest DCT frequencies, each bit = above the median. */
export function phashOf(pixels: Uint8Array): string {
  // separable 2D DCT: rows first, then columns, keeping only the low frequencies
  const rows = new Float64Array(N * K);
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += pixels[y * N + x]! * COS[u]![x]!;
      rows[y * K + u] = s;
    }
  }
  const coeffs = new Float64Array(K * K);
  for (let v = 0; v < K; v++) {
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y * K + u]! * COS[v]![y]!;
      coeffs[v * K + u] = s;
    }
  }
  // the DC term is overall brightness, not structure: leave it out of the median
  const median = [...coeffs.subarray(1)].sort((a, b) => a - b)[(K * K - 1) >> 1]!;
  let hex = '';
  for (let i = 0; i < K * K; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (coeffs[i + b]! > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

/** Number of differing bits between two pHashes (0–64). */
export function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      x &= x - 1;
      d++;
    }
  }
  return d;
}

/** Mean absolute difference of the colour signatures (0–255). */
export function colorDistance(a: string, b: string): number {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i]! - y[i]!);
  return s / x.length;
}
