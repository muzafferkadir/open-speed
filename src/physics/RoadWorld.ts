// Route world built from the source road data: the drivable corridor replayed as a
// surface. Every spine point carries the source frame, so elevation, banking, slopes and the
// left/right drivable limits come from the data rather than a fitted approximation. No three.js.

import type { Surface, World } from './types';

/**
 * One track built by scripts/extract-collision.mjs.
 * - `points` spine position in metres, one record per ~4 m.
 * - `halfWidth` [left, right] drivable limit in metres along `right`; asymmetric where the source is.
 * - `right` lateral axis per point, flat [x, y, z] triples. Its vertical component carries the
 *   banking, so offsets run along the banked surface.
 */
/** Horizon/sky descriptor decoded from the track's `TRxx.HRZ` (scripts/source/hrz.mjs). */
export type RoadSky = {
 blackHorizon: boolean; mirror: boolean; radius: number; rotation: number;
 projectionDistance: number; baseHeight: number; height: number; pixmapBase: number;
 sky: [number, number, number]; horizonBase: [number, number, number];
 depthCues: number[]; depthCueLights: number[]; colorSystem: number; rgb: [number, number, number];
};

export type RoadTrack = {
 kind: 'road'; id: string; name: string; description: string;
 length: number; step: number; laps: number;
 points: [number, number, number][];
 halfWidth: [number, number][];
 right: number[];
 sky?: RoadSky | null;
 sky3?: RoadHrz3 | null;
 light?: RoadLight | null;
 speeds?: RoadSpeeds | null;
};

/**
 * Horizon descriptor of the 3D-accelerated renderer (`3Trxx.HRZ`, `game/3rash/hrzsku.c`). The
 * horizon is a ring of `radius` metres around the camera, Gouraud-shaded in two bands: an EARTH
 * band from `baseHeight` to `baseHeight + midpoint`, a SKY band from there to `baseHeight +
 * height`. `pixmapTop`/`pixmapBottom` bound the horizon pixmap band (the `CLD*` cloud sprites in
 * `SKY.FSH`). Colours are 0-255 RGB; heights are metres from the ring centre.
 */
export type RoadHrz3 = {
 cloudDome: number[]; blackHorizon: boolean; mirror: boolean; radius: number; rotation: number;
 projectionDistance: number; baseHeight: number; height: number; midpoint: number;
 pixmapTop: number; pixmapBottom: number;
 earthTop: [number, number, number]; earthBase: [number, number, number];
 skyTop: [number, number, number];
 skyBaseSun: [number, number, number]; skyBaseOpposite: [number, number, number];
};

/**
 * Track light/depth-cue descriptor read by `scripts/source/lgt.mjs`.
 * `depthCue` pairs a distance in metres with the engine's light level at that distance; the
 * renderer fades distant geometry along them. `palette` is the 16-entry shading ramp and
 * `sfxLight` the two special-effect light colours (brake/tail). All eight tracks ship an
 * identical file, so this is the shared default.
 */
export type RoadLight = {
 depthCue: [number, number][];
 palette: [number, number, number][];
 minIntensity: number;
 maxIntensity: number;
 sfxLightType: number;
 sfxLight: [number, number, number][];
};

/**
 * AI speeds dataset inventory (`Tracks/Speeds/`, `game/common/aispeeds.c`). Measured, not driven
 * by: the shipped `TR04` uncompressed set is a byte-identical copy of `TR05`'s and counts 1877
 * records against TR04's own 1863, so it carries no TR04-specific AI line or speed.
 */
export type RoadSpeeds = {
 dir: string; track: string; records: number | null;
 files: Record<string, { length: number; header: number | null; zeroBytes: number; min: number; max: number; minUnsigned: number; maxUnsigned: number; perRecord: boolean }>;
 duplicateTrack?: string;
 duplicateOf?: Record<string, boolean>;
};

type Frame = {
 x: number; y: number; z: number; tx: number; tz: number; ox: number; oy: number; oz: number;
 left: number; right: number;
};

const KERB_BAND = 2;
const WALL_GAP = 0.5;
/** Metres kept between the drivable limit and the rock that was measured there. */
const WALL_MARGIN = 1.2;
/** However close or far the rock is, the corridor stays between these, in metres from the centre. */
const MIN_HALF_WIDTH = 4.5, MAX_HALF_WIDTH = 40;
const APRON_DROP = 0.04;
const CELL = 24;

export class RoadWorld implements World {
 readonly circuit: [number, number][];
 readonly length: number;
 readonly frames: Frame[];
 readonly track: RoadTrack;
 private readonly step: number;
 private readonly n: number;
 private readonly cells = new Map<string, number[]>();

 constructor(track: RoadTrack) {
  this.track = track;
  const p = track.points, n = p.length;
  // Frames close over `length`, so one frame of arc is length / n. The source records are near
  // uniform (n*step within 0.2 m of length), but deriving it keeps the seam exact.
  this.n = n; this.step = track.length / n; this.length = track.length;
  this.frames = p.map((q, i) => {
   const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
   const tx = b[0] - a[0], tz = b[2] - a[2], len = Math.hypot(tx, tz) || 1;
   const ox = track.right[i * 3], oy = track.right[i * 3 + 1], oz = track.right[i * 3 + 2];
   return {
    x: q[0], y: q[1], z: q[2], tx: tx / len, tz: tz / len, ox, oy, oz,
    left: track.halfWidth[i][0], right: track.halfWidth[i][1],
   };
  });
  this.circuit = p.map(q => [q[0], q[2]]);
  for (let i = 0; i < n; i++) {
   const a = this.frames[i], b = this.frames[(i + 1) % n];
   for (const cx of cellsBetween(a.x, b.x)) for (const cz of cellsBetween(a.z, b.z)) {
    const key = `${cx},${cz}`;
    (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(i);
   }
  }
 }

 private wrap(s: number) { return ((s % this.length) + this.length) % this.length; }

 frame(s: number): Frame {
  const wrapped = this.wrap(s), t = wrapped / this.step, i = Math.floor(t) % this.n, f = t - Math.floor(t);
  const a = this.frames[i], b = this.frames[(i + 1) % this.n];
  const l = (u: number, v: number) => u + (v - u) * f;
  const tx = l(a.tx, b.tx), tz = l(a.tz, b.tz), tl = Math.hypot(tx, tz) || 1;
  let ox = l(a.ox, b.ox), oy = l(a.oy, b.oy), oz = l(a.oz, b.oz);
  const ol = Math.hypot(ox, oy, oz) || 1;
  ox /= ol; oy /= ol; oz /= ol;
  return {
   x: l(a.x, b.x), y: l(a.y, b.y), z: l(a.z, b.z), tx: tx / tl, tz: tz / tl, ox, oy, oz,
   left: l(a.left, b.left), right: l(a.right, b.right),
  };
 }

 /**
  * Offsetting along `right` is the source definition: on a banked record the lateral axis has a
  * vertical component, so the surface rises with the bank. `out` only covers the gravel apron.
  */
 private heightOn(f: Frame, lateral: number, out: number): number {
  return f.y + lateral * f.oy - (out > 0 ? out * APRON_DROP : 0);
 }

 surfacePoint(s: number, lateral: number) {
  const f = this.frame(s);
  const out = this.overhang(f, lateral);
  return {
   x: f.x + f.ox * lateral, y: this.heightOn(f, lateral, out), z: f.z + f.oz * lateral,
   yaw: Math.atan2(-f.tx, -f.tz),
  };
 }

 private overhang(f: Frame, lateral: number): number {
  const limit = lateral < 0 ? f.left : f.right;
  return Math.max(0, Math.abs(lateral) - limit);
 }

 locate(x: number, z: number) {
  const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const list = this.cells.get(key);
  let best = Infinity, bi = 0, bt = 0;
  const test = (i: number) => {
   const a = this.frames[i], b = this.frames[(i + 1) % this.n];
   const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
   const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
   const d = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
   if (d < best) { best = d; bi = i; bt = t; }
  };
  if (list) for (const i of list) test(i);
  else for (let i = 0; i < this.n; i++) test(i);
  const s = this.wrap((bi + bt) * this.step);
  const f = this.frame(s);
  // Horizontal projection onto the lateral axis; the axis is unit length in the road plane.
  const flat = f.ox * f.ox + f.oz * f.oz || 1;
  return { s, lateral: ((x - f.x) * f.ox + (z - f.z) * f.oz) / flat, tx: f.tx, tz: f.tz };
 }

 heightAt(x: number, z: number): number {
  const { s, lateral } = this.locate(x, z);
  const f = this.frame(s);
  return this.heightOn(f, lateral, this.overhang(f, lateral));
 }

 /** Frame at a loop distance, for tests and scene code that needs the source axis. */
 frameAt(s: number): Frame { return this.frame(s); }

 corridor(s: number): { left: number; right: number } {
  const f = this.frame(s);
  return { left: f.left, right: f.right };
 }

 surfaceAt(x: number, z: number): Surface {
  const { s, lateral } = this.locate(x, z);
  const f = this.frame(s), out = this.overhang(f, lateral);
  return out <= 0 ? 'road' : out <= KERB_BAND ? 'kerb' : 'ground';
 }

 /**
  * Replaces the drivable limits with what was measured against the track mesh.
  *
  * The corridor the source ships is its own drivable width, and the rock that is drawn is a
  * different thing: across the loop they disagree by up to 20 m either way. Where the corridor is
  * the wider of the two a car drives through the rock and ends up outside the world; where it is
  * the tighter one the car catches on nothing at all. A measured wall is the honest limit.
  *
  * `left` and `right` are metres from the centre line per frame; a negative entry means no wall
  * was found there, so the source limit stands.
  */
 applyMeasuredWalls(left: Float32Array, right: Float32Array): void {
  for (let i = 0; i < this.frames.length; i++) {
   const frame = this.frames[i];
   if (left[i] > 0) frame.left = clamp(left[i] - WALL_MARGIN, MIN_HALF_WIDTH, MAX_HALF_WIDTH);
   if (right[i] > 0) frame.right = clamp(right[i] - WALL_MARGIN, MIN_HALF_WIDTH, MAX_HALF_WIDTH);
  }
 }

 hit(x: number, z: number, radius: number) {
  const { s, lateral } = this.locate(x, z);
  const f = this.frame(s);
  const limit = lateral < 0 ? f.left : f.right;
  const depth = Math.abs(lateral) + radius - (limit + WALL_GAP);
  if (depth <= 0) return null;
  const side = Math.sign(lateral) || 1;
  return { nx: -side * f.ox, nz: -side * f.oz, depth };
 }

 curveAhead(x: number, z: number): number {
  const s = this.locate(x, z).s;
  const a = this.frame(s), b = this.frame(s + 300);
  let d = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.round(-d / (2 * Math.PI) * 1024);
 }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function cellsBetween(a: number, b: number): number[] {
 const lo = Math.floor((Math.min(a, b) - CELL) / CELL), hi = Math.floor((Math.max(a, b) + CELL) / CELL);
 const out: number[] = [];
 for (let c = lo; c <= hi; c++) out.push(c);
 return out;
}
