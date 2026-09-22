// original FSH/QFS texture archive reader.
// QFS is EA's LZ77 variant; FSH ("SHPI") is the texture container. Layouts follow the
// the shared FSH structures (FshArchive, FshTexture, QfsCompression).

import zlib from 'node:zlib';

const u16 = (b, o) => b.readUInt16LE(o);
const i16 = (b, o) => b.readInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

export const isQfs = (data) => data.length >= 5 && (data[0] & 0xfe) === 0x10 && data[1] === 0xfb;

/** QFS stream decompression. Header is 5 bytes, or 8 when byte 0 has bit 0 set. */
export function decompressQfs(input) {
  if (!isQfs(input)) throw new Error('QFS: bad magic');
  const outSize = (input[2] << 16) | (input[3] << 8) | input[4];
  const out = Buffer.alloc(outSize);
  let inPos = input[0] & 0x01 ? 8 : 5, outPos = 0;
  const copy = (from, len) => { for (let i = 0; i < len; i++) out[outPos++] = out[from + i]; };
  const literals = (at, len) => { for (let i = 0; i < len; i++) out[outPos++] = input[at + i]; };
  while (inPos < input.length && input[inPos] < 0xfc) {
    const pack = input[inPos], byte1 = input[inPos + 1] ?? 0, byte2 = input[inPos + 2] ?? 0;
    if (!(pack & 0x80)) {
      const lit = pack & 0x03;
      literals(inPos + 2, lit);
      inPos += lit + 2;
      copy(outPos - (((pack >> 5) << 8) + byte1 + 1), ((pack & 0x1c) >> 2) + 3);
    } else if (!(pack & 0x40)) {
      const lit = (byte1 >> 6) & 0x03;
      literals(inPos + 3, lit);
      inPos += lit + 3;
      copy(outPos - ((byte1 & 0x3f) * 256 + byte2 + 1), (pack & 0x3f) + 4);
    } else if (!(pack & 0x20)) {
      const byte3 = input[inPos + 3] ?? 0, lit = pack & 0x03;
      literals(inPos + 4, lit);
      inPos += lit + 4;
      copy(outPos - (((pack & 0x10) << 12) + 256 * byte1 + byte2 + 1), ((pack >> 2) & 0x03) * 256 + byte3 + 5);
    } else {
      const lit = (pack & 0x1f) * 4 + 4;
      literals(inPos + 1, lit);
      inPos += lit + 1;
    }
  }
  if (inPos < input.length && outPos < outSize) literals(inPos + 1, input[inPos] & 0x03);
  return out;
}

/** `code` is the low byte of the entry header: format plus a compression flag. */
const isBitmap = (code) => [0x78, 0x7b, 0x7d, 0x7e, 0x7f, 0x6d, 0x60, 0x61, 0x40, 0x41].includes(code & 0x7f);
const isPalette = (code) => [0x22, 0x23, 0x24, 0x29, 0x2a, 0x2d].includes(code & 0x7f);

const entry = (data, offset) => ({
  code: u32(data, offset), width: i16(data, offset + 4), height: i16(data, offset + 6),
  next: u32(data, offset) >>> 8, format: u32(data, offset) & 0xff,
});

const bytesPerPixel = (format) => ({ 0x7d: 4, 0x7f: 3, 0x7e: 2, 0x79: 2, 0x78: 2, 0x6d: 2 })[format] ?? 1;

function readPalette(data, offset, n) {
  const format = u32(data, offset) & 0xff, p = offset + 16, colors = new Array(n);
  for (let i = 0; i < n; i++) {
    if (format === 0x24) colors[i] = [data[p + i * 3], data[p + i * 3 + 1], data[p + i * 3 + 2], 255];
    else if (format === 0x22) colors[i] = [data[p + i * 3] << 2, data[p + i * 3 + 1] << 2, data[p + i * 3 + 2] << 2, 255];
    else {
      const v = u16(data, p + i * 2);
      if (format === 0x2d) colors[i] = [((v >> 10) & 0x1f) << 3, ((v >> 5) & 0x1f) << 3, (v & 0x1f) << 3, v & 0x8000 ? 255 : 0];
      else if (format === 0x23 || format === 0x79) colors[i] = [(v & 0x1f) << 3, ((v >> 5) & 0x1f) << 3, ((v >> 10) & 0x1f) << 3, v & 0x8000 ? 255 : 0];
      else if (format === 0x29) colors[i] = [((v >> 11) & 0x1f) << 3, ((v >> 5) & 0x3f) << 2, (v & 0x1f) << 3, 255];
      else colors[i] = [((v >> 16) & 0xff), ((v >> 8) & 0xff), v & 0xff, (v >>> 24) & 0xff];
    }
  }
  return colors;
}

/** Decode one texture entry into RGBA. */
function decodeTexture(data, name, offset, nextOffset, globalPalette) {
  const head = entry(data, offset), format = head.format & 0x7f, { width, height } = head;
  let palette = null;
  for (let at = offset, h = head; h.next > 0;) {
    at += h.next;
    if (at + 16 > data.length) break;
    h = entry(data, at);
    if (isPalette(h.format)) palette = readPalette(data, at, h.width);
  }
  if (!palette) palette = globalPalette;

  const size = width * height * (format === 0x40 || format === 0x41 || format === 0x7b ? 1 : bytesPerPixel(format));
  const start = offset + 16;
  let raw;
  if (head.format & 0x80) raw = decompressQfs(data.subarray(start, nextOffset));
  else raw = data.subarray(start, Math.min(start + size, data.length));

  const rgba = new Uint8Array(width * height * 4);
  const set = (i, r, g, b, a = 255) => { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a; };
  // The transparent colour key. Every TR04 texture is indexed 8-bit (format 0x7b) with an
  // RGB24 palette and no alpha attachment, so the palette itself cannot encode transparency. The
  // key is the pure magenta texel: pure magenta (255,0,255) does not appear in the terrain art and
  // is used only as the background of the cut-out sprites (requested: trees, bushes, fences,
  // banners). Measured on TR040.QFS: 102 of 428 textures are >50% magenta and all are 0x7b.
  const isKey = (r, g, b) => r === 255 && g === 0 && b === 255;
  let keyed = 0;
  for (let i = 0; i < width * height; i++) {
    switch (format) {
      case 0x7d: set(i, raw[i * 4 + 2], raw[i * 4 + 1], raw[i * 4], raw[i * 4 + 3]); break;
      case 0x7f: set(i, raw[i * 3 + 2], raw[i * 3 + 1], raw[i * 3]); break;
      case 0x40: { const c = palette?.[raw[i] & 0x0f] ?? [255, 0, 255, 255]; set(i, c[0], c[1], c[2], isKey(c[0], c[1], c[2]) ? 0 : c[3]); break; }
      case 0x41: case 0x7b: { const c = palette?.[raw[i]] ?? [255, 0, 255, 255]; set(i, c[0], c[1], c[2], isKey(c[0], c[1], c[2]) ? 0 : c[3]); break; }
      case 0x78: { const v = u16(raw, i * 2); set(i, ((v >> 11) & 0x1f) << 3, ((v >> 5) & 0x3f) << 2, (v & 0x1f) << 3); break; }
      case 0x7e: { const v = u16(raw, i * 2); set(i, ((v >> 10) & 0x1f) << 3, ((v >> 5) & 0x1f) << 3, (v & 0x1f) << 3, v & 0x8000 ? 255 : 0); break; }
      case 0x6d: { const v = u16(raw, i * 2); set(i, ((v >> 8) & 0xf) * 17, ((v >> 4) & 0xf) * 17, (v & 0xf) * 17, (v >> 12) * 17); break; }
      default: set(i, 255, 0, 255); break;
    }
    if (rgba[i * 4 + 3] === 0) keyed++;
  }
  return { name, width, height, format, rgba, keyed };
}

/** Read an FSH (optionally QFS-compressed) archive into decoded textures. */
export function readFsh(file) {
  const raw = Buffer.isBuffer(file) ? file : Buffer.from(file);
  const data = isQfs(raw) ? decompressQfs(raw) : raw;
  if (data.toString('latin1', 0, 4) !== 'SHPI' && data.toString('latin1', 0, 4) !== 'SHPP') throw new Error('FSH: bad magic');
  const fileSize = u32(data, 4), n = u32(data, 8);
  const directoryId = data.toString('latin1', 12, 16);
  const entries = Array.from({ length: n }, (_, i) => ({
    name: data.toString('latin1', 16 + i * 8, 20 + i * 8), offset: u32(data, 20 + i * 8),
  }));

  let globalPalette = null;
  const pal = entries.find(e => e.name === '!pal') ?? entries.find(e => isPalette(u32(data, e.offset) & 0xff));
  if (pal) globalPalette = readPalette(data, pal.offset, i16(data, pal.offset + 4));

  const textures = [], skipped = [];
  for (const e of entries) {
    if (!isBitmap(u32(data, e.offset) & 0xff)) continue;
    let next = fileSize;
    for (const o of entries) if (o.offset > e.offset && o.offset < next) next = o.offset;
    const t = decodeTexture(data, e.name, e.offset, next, globalPalette);
    if (t.width > 0 && t.height > 0) textures.push(t);
    else skipped.push(e.name);
  }
  return { compressed: isQfs(raw), directoryId, fileSize, entries, globalPalette, textures, skipped };
}

/** Encode RGBA pixels as a PNG (8-bit, no palette) so the result can be inspected anywhere. */
export function encodePng({ width, height, rgba }) {
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
