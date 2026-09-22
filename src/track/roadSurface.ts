// Procedural replacements for the tiny source road tiles, which are 64-128 px
// flat noise field, so at speed the route smears into a grey band. These tiles keep the source
// tone (and any painted line pixels) while adding aggregate detail, a wheel-track polish and a
// faint normal. Everything is generated at load time in the browser; nothing is added to the GLB,
// so the meshopt/WebP budget is untouched. This module is pure (no three.js, no DOM) so the tile
// maths is unit-tested under node.

export type Tile = { width: number; height: number; rgba: Uint8ClampedArray };
export type Rgb = [number, number, number];
export type MarkingMask = { columns: boolean[]; rows: boolean[] };

const hash = (x: number, y: number, seed: number): number => {
 let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
 h = Math.imul(h ^ (h >>> 13), 1274126177);
 return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise in [0, 1); the lattice wraps over `period` so a tile stays seamless. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
 const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
 const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
 const wrap = (v: number) => ((v % period) + period) % period;
 const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
 const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
 const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
 return top + (bottom - top) * sy;
}

/** Fractal value noise in [0, 1); each octave doubles the frequency and keeps the wrap. */
export function fbm(x: number, y: number, period: number, seed: number, octaves = 3): number {
 let sum = 0, amp = 1, total = 0, freq = 1, per = period;
 for (let o = 0; o < octaves; o++) {
  sum += amp * valueNoise(x * freq, y * freq, per * freq, seed + o * 101);
  total += amp;
  amp *= 0.5;
  freq *= 2;
  per *= 2;
 }
 return sum / total;
}

/** Mean colour of a tile, matching a generated surface to the source art it replaces. */
export function tileMean(tile: Tile): Rgb {
 const { rgba } = tile;
 let r = 0, g = 0, b = 0;
 const n = tile.width * tile.height;
 for (let i = 0; i < n; i++) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; }
 return [r / n, g / n, b / n];
}

export const MARKING_THRESHOLD = 170;

/**
 * Painted road markings are the bright, low-saturation texels of a source tile. A column counts as
 * a line when most of its texels are bright, and likewise a row, so the mask survives upscaling and
 * can be redrawn at any tile size. The Last Resort asphalt carries no such lines (measured
 * against TR040.QFS); the mask keeps the artist's layout had there been one.
 */
export function markingMask(tile: Tile, threshold = MARKING_THRESHOLD): MarkingMask {
 const { width, height, rgba } = tile;
 const columns = new Array<boolean>(width).fill(false);
 const rows = new Array<boolean>(height).fill(false);
 const bright = (i: number) => {
  const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
  return (r + g + b) / 3 >= threshold && Math.max(r, g, b) - Math.min(r, g, b) <= 40;
 };
 for (let x = 0; x < width; x++) {
  let hit = 0;
  for (let y = 0; y < height; y++) if (bright(y * width + x)) hit++;
  if (hit >= height * 0.5) columns[x] = true;
 }
 for (let y = 0; y < height; y++) {
  let hit = 0;
  for (let x = 0; x < width; x++) if (bright(y * width + x)) hit++;
  if (hit >= width * 0.5) rows[y] = true;
 }
 return { columns, rows };
}

const gaussian = (v: number, centre: number, width: number) => Math.exp(-((v - centre) ** 2) / (2 * width * width));

/**
 * Tiled asphalt: aggregate noise over a slow macro variation, tinted by the source tile's own mean
 * colour so the concrete/dirt variants keep their hue. A `track` (normalised across-road position)
 * darkens the wheel path the way rubber polishes the surface.
 */
export function asphaltTile(opts: { size: number; tone: Rgb; seed?: number; track?: number; markings?: MarkingMask }): Tile {
 const { size, tone } = opts, seed = opts.seed ?? 1, track = opts.track;
 const rgba = new Uint8ClampedArray(size * size * 4);
 for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const fu = x / size, fv = y / size;
  const fine = fbm(fu * 24, fv * 24, 24, seed, 3) - 0.5;
  const macro = fbm(fu * 4, fv * 4, 4, seed + 7, 2) - 0.5;
  let shade = 1 + fine * 0.24 + macro * 0.10;
  if (track !== undefined) shade *= 1 - 0.15 * gaussian(fu, track, 0.11);
  const i = (y * size + x) * 4;
  rgba[i] = tone[0] * shade;
  rgba[i + 1] = tone[1] * shade;
  rgba[i + 2] = tone[2] * shade;
  rgba[i + 3] = 255;
 }
 if (opts.markings) compositeMarkings(rgba, size, size, opts.markings, [235, 233, 225]);
 return { width: size, height: size, rgba };
}

/** Redraws a source marking mask, upscaled to the tile, in the given paint colour. */
function compositeMarkings(rgba: Uint8ClampedArray, width: number, height: number, mask: MarkingMask, paint: Rgb): void {
 const columns = mask.columns.length, rows = mask.rows.length;
 for (let x = 0; x < width; x++) {
  if (!mask.columns[Math.min(columns - 1, Math.floor(x / width * columns))]) continue;
  for (let y = 0; y < height; y++) rgba.set(paint, (y * width + x) * 4);
 }
 for (let y = 0; y < height; y++) {
  if (!mask.rows[Math.min(rows - 1, Math.floor(y / height * rows))]) continue;
  for (let x = 0; x < width; x++) rgba.set(paint, (y * width + x) * 4);
 }
}

/** Roughness companion of {@link asphaltTile}: wheel tracks read slightly smoother (0.9 -> 0.7). */
export function asphaltRoughTile(opts: { size: number; seed?: number; track?: number }): Tile {
 const { size } = opts, seed = opts.seed ?? 1, track = opts.track;
 const rgba = new Uint8ClampedArray(size * size * 4);
 for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const fu = x / size, fv = y / size;
  let rough = 0.92 + (fbm(fu * 24, fv * 24, 24, seed + 31, 2) - 0.5) * 0.06;
  if (track !== undefined) rough -= 0.20 * gaussian(fu, track, 0.13);
  const v = Math.max(0, Math.min(1, rough)) * 255;
  rgba.set([v, v, v, 255], (y * size + x) * 4);
 }
 return { width: size, height: size, rgba };
}

/** Tangent-space normal from the asphalt height field, so the low sun sheens over the grain. */
export function asphaltNormalTile(opts: { size: number; seed?: number; strength?: number }): Tile {
 const { size } = opts, seed = opts.seed ?? 1, strength = opts.strength ?? 1.2;
 const height = (x: number, y: number) => fbm(x / size * 24, y / size * 24, 24, seed, 3);
 const rgba = new Uint8ClampedArray(size * size * 4);
 for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = height(x + 1, y) - height(x - 1, y);
  const dy = height(x, y + 1) - height(x, y - 1);
  const nx = -dx * strength, ny = -dy * strength, nz = 1;
  const len = Math.hypot(nx, ny, nz);
  rgba.set([(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (nz / len * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
 }
 return { width: size, height: size, rgba };
}

/**
 * Verge/shoulder ground: a sand-to-grass gradient away from the road with the same seeded grain, so
 * the flat brown band beside the asphalt gets depth. `near` sits at v = 0, `far` at v = 1.
 */
export function vergeTile(opts: { size: number; near: Rgb; far: Rgb; seed?: number }): Tile {
 const { size, near, far } = opts, seed = opts.seed ?? 1;
 const rgba = new Uint8ClampedArray(size * size * 4);
 for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const fu = x / size, fv = y / size;
  const grain = 1 + (fbm(fu * 18, fv * 18, 18, seed, 3) - 0.5) * 0.22 + (fbm(fu * 3, fv * 3, 3, seed + 5, 2) - 0.5) * 0.12;
  const i = (y * size + x) * 4;
  for (let c = 0; c < 3; c++) rgba[i + c] = (near[c] + (far[c] - near[c]) * fv) * grain;
  rgba[i + 3] = 255;
 }
 return { width: size, height: size, rgba };
}
