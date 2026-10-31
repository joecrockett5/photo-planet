/**
 * Locate the raw EXIF (TIFF) block inside HEIC/HEIF and WebP files. exifr reads
 * JPEG/PNG fine, but doesn't read WebP and trips on some HEIC layouts, so for
 * those we pull the TIFF block out ourselves and hand exifr just that.
 */

/** Returns the TIFF block (starting with `II*\0` / `MM\0*`), or null. */
export function findExifBlock(buf: Buffer): Buffer | null {
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return findWebpExif(buf);
  }
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    return findHeifExif(buf);
  }
  return null;
}

function toTiff(block: Buffer): Buffer | null {
  // Some writers prefix "Exif\0\0"; skip to the TIFF header either way.
  for (let i = 0; i + 4 <= Math.min(block.length, 64); i++) {
    const sig = block.toString('latin1', i, i + 4);
    if (sig === 'II*\0' || sig === 'MM\0*') return block.subarray(i);
  }
  return null;
}

function findWebpExif(buf: Buffer): Buffer | null {
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const type = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (type === 'EXIF') return toTiff(buf.subarray(start, Math.min(start + size, buf.length)));
    pos = start + size + (size & 1);
  }
  return null;
}

interface Box {
  type: string;
  start: number; // payload start
  end: number;
}

function* boxes(buf: Buffer, from: number, to: number): Generator<Box> {
  let pos = from;
  while (pos + 8 <= to) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < header || pos + size > to) return;
    yield { type, start: pos + header, end: pos + size };
    pos += size;
  }
}

function readUInt(buf: Buffer, pos: number, bytes: number): number {
  switch (bytes) {
    case 0:
      return 0;
    case 1:
      return buf.readUInt8(pos);
    case 2:
      return buf.readUInt16BE(pos);
    case 4:
      return buf.readUInt32BE(pos);
    case 8:
      return Number(buf.readBigUInt64BE(pos));
    default:
      throw new Error(`bad field size ${bytes}`);
  }
}

function findHeifExif(buf: Buffer): Buffer | null {
  try {
    const meta = [...boxes(buf, 0, buf.length)].find((b) => b.type === 'meta');
    if (!meta) return null;
    const children = [...boxes(buf, meta.start + 4, meta.end)]; // meta is a FullBox
    const iinf = children.find((b) => b.type === 'iinf');
    const iloc = children.find((b) => b.type === 'iloc');
    const idat = children.find((b) => b.type === 'idat');
    if (!iinf || !iloc) return null;

    // iinf: find the item whose type is 'Exif'.
    const iinfVersion = buf[iinf.start]!;
    const entriesStart = iinf.start + 4 + (iinfVersion === 0 ? 2 : 4);
    let exifId: number | null = null;
    for (const infe of boxes(buf, entriesStart, iinf.end)) {
      if (infe.type !== 'infe') continue;
      const v = buf[infe.start]!;
      if (v < 2) continue;
      const idBytes = v === 2 ? 2 : 4;
      const id = readUInt(buf, infe.start + 4, idBytes);
      const type = buf.toString('latin1', infe.start + 4 + idBytes + 2, infe.start + 4 + idBytes + 6);
      if (type === 'Exif') {
        exifId = id;
        break;
      }
    }
    if (exifId === null) return null;

    // iloc: find that item's extents.
    let p = iloc.start;
    const version = buf[p]!;
    p += 4;
    const offsetSize = buf[p]! >> 4;
    const lengthSize = buf[p]! & 0xf;
    const baseOffsetSize = buf[p + 1]! >> 4;
    const indexSize = version === 1 || version === 2 ? buf[p + 1]! & 0xf : 0;
    p += 2;
    const itemCount = version < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p);
    p += version < 2 ? 2 : 4;
    for (let i = 0; i < itemCount; i++) {
      const id = version < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p);
      p += version < 2 ? 2 : 4;
      let method = 0;
      if (version === 1 || version === 2) {
        method = buf.readUInt16BE(p) & 0xf;
        p += 2;
      }
      p += 2; // data_reference_index
      const baseOffset = readUInt(buf, p, baseOffsetSize);
      p += baseOffsetSize;
      const extentCount = buf.readUInt16BE(p);
      p += 2;
      const parts: Buffer[] = [];
      for (let e = 0; e < extentCount; e++) {
        p += indexSize;
        const offset = readUInt(buf, p, offsetSize);
        p += offsetSize;
        const length = readUInt(buf, p, lengthSize);
        p += lengthSize;
        if (id !== exifId) continue;
        const origin = method === 1 && idat ? idat.start : 0;
        const start = origin + baseOffset + offset;
        parts.push(buf.subarray(start, length ? start + length : buf.length));
      }
      if (id === exifId) {
        const data = Buffer.concat(parts);
        if (data.length < 4) return null;
        // Exif item payload: u32 offset to the TIFF header, then the block.
        const tiffOffset = data.readUInt32BE(0);
        return toTiff(data.subarray(4 + Math.min(tiffOffset, data.length - 4))) ?? toTiff(data.subarray(4));
      }
    }
    return null;
  } catch {
    return null;
  }
}
