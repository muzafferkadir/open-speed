// Numeric probe for a screenshot: mean colour of rectangles, a vertical scan of a column, the
// mean of the green-dominant pixels (foliage albedo check) and the share of coloured pixels
// (a textureless, sky-tinted prop reads as near-grey).
// Usage: node scripts/verify/png-probe.mjs <png> [--col x] [--rect x,y,w,h] [--green] [--sat]
// Decodes 8-bit non-interlaced RGB/RGBA PNGs (what Chrome's headless screenshot produces).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decode(file) {
  const b = readFileSync(file);
  let o = 8, w = 0, h = 0, color = 6;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.slice(o + 4, o + 8).toString();
    if (type === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); color = b[o + 17]; }
    if (type === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len));
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const ch = color === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, bb = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += bb; else if (filter === 3) v += (a + bb) >> 1;
      else if (filter === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, ch, data: out };
}

const px = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const mean = (img, x0, y0, w, h) => {
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const [a, b, c] = px(img, x, y); r += a; g += b; bl += c; n++; }
  return [r / n, g / n, bl / n].map(v => Math.round(v));
};

const args = process.argv.slice(2);
const img = decode(args[0]);
console.log(`size ${img.w}x${img.h} ch${img.ch}`);
const rectI = args.indexOf('--rect');
const region = rectI >= 0 ? args[rectI + 1].split(',').map(Number) : [0, 0, img.w, img.h];
if (args.includes('--sat')) {
 // A prop that lost its albedo renders as a pale sky-tinted grey; real wood/thatch keeps a
 // saturation spread, so the share of coloured texels is the number that moves.
 let sum = 0, n = 0, coloured = 0;
 for (let y = region[1]; y < region[1] + region[3]; y++) for (let x = region[0]; x < region[0] + region[2]; x++) {
  const [r, g, b] = px(img, x, y);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  sum += spread; n++;
  if (spread > 25) coloured++;
 }
 console.log(`saturation rect ${region.join(',')} mean spread ${Math.round(sum / (n || 1))} coloured ${((coloured / (n || 1)) * 100).toFixed(1)}%`);
}
if (args.includes('--green')) {
 // Foliage albedo: the texels where green clearly dominates the other two channels.
 let r = 0, g = 0, bl = 0, n = 0;
 for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
  const [a, b, c] = px(img, x, y);
  if (b > a + 8 && b > c + 8) { r += a; g += b; bl += c; n++; }
 }
 console.log(`green ${n} px mean ${[r, g, bl].map(v => Math.round(v / (n || 1))).join(',')}`);
} else {
const colI = args.indexOf('--col');
const col = colI >= 0 ? Number(args[colI + 1]) : img.w >> 1;
if (rectI >= 0) {
  const [x, y, w, h] = region;
  console.log(`rect ${x},${y} ${w}x${h} mean ${mean(img, x, y, w, h).join(',')}`);
} else {
  for (let i = 0; i <= 10; i++) {
    const y = Math.round((i / 10) * (img.h - 1));
    console.log(`y=${String(y).padStart(4)} ${px(img, col, y).join(',')}`);
  }
}
}
