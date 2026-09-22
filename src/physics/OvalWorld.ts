// Banked oval track (Proving Grounds centre line) as a World: banked surface height,
// road/kerb/dirt surfaces, side walls, loop distance. No three.js.

import type { Surface, World } from './types';

export type OvalTrack = {
 kind: 'oval'; id: string; name: string; description: string;
 length: number; step: number; width: number; maxBankDeg: number; laps: number;
 points: [number, number, number][]; curvature: number[];
};

type Frame = { x: number; y: number; z: number; tx: number; tz: number; ox: number; oz: number; bank: number };

const KERB_BAND = 2;
const WALL_GAP = 0.5;
const APRON_DROP = 0.04;
const CELL = 24;

export class OvalWorld implements World {
 readonly circuit: [number, number][];
 readonly length: number;
 readonly halfWidth: number;
 readonly frames: Frame[];
 private readonly step: number;
 private readonly n: number;
 private readonly cells = new Map<string, number[]>();
 private hint = 0;
 readonly track: OvalTrack;

 constructor(track: OvalTrack) {
  this.track = track;
  const p = track.points, n = p.length;
  // The loop closes over `length`, so one frame of arc is length / n -- not the raw sample pitch,
  // which would leave a gap at the seam and distort the elevation profile there.
  this.n = n; this.step = track.length / n; this.length = track.length; this.halfWidth = track.width / 2;
  const maxBank = track.maxBankDeg * Math.PI / 180;
  const gain = maxBank / Math.max(...track.curvature.map(Math.abs));
  this.frames = p.map((q, i) => {
   const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
   const tx = b[0] - a[0], tz = b[2] - a[2], len = Math.hypot(tx, tz) || 1;
   return { x: q[0], y: q[1], z: q[2], tx: tx / len, tz: tz / len, ox: tz / len, oz: -tx / len, bank: clamp(track.curvature[i] * gain, -maxBank, maxBank) };
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
  const t = this.wrap(s) / this.step, i = Math.floor(t) % this.n, f = t - Math.floor(t);
  const a = this.frames[i], b = this.frames[(i + 1) % this.n];
  const l = (u: number, v: number) => u + (v - u) * f;
  const tx = l(a.tx, b.tx), tz = l(a.tz, b.tz), tl = Math.hypot(tx, tz) || 1;
  const ox = l(a.ox, b.ox), oz = l(a.oz, b.oz), ol = Math.hypot(ox, oz) || 1;
  return { x: l(a.x, b.x), y: l(a.y, b.y), z: l(a.z, b.z), tx: tx / tl, tz: tz / tl, ox: ox / ol, oz: oz / ol, bank: l(a.bank, b.bank) };
 }

 corridor(): { left: number; right: number } { return { left: this.halfWidth, right: this.halfWidth }; }

 surfacePoint(s: number, lateral: number) {
  const f = this.frame(s);
  return { x: f.x + f.ox * lateral, y: this.heightOn(f, lateral), z: f.z + f.oz * lateral, yaw: Math.atan2(-f.tx, -f.tz) };
 }

 private heightOn(f: Frame, lateral: number): number {
  const edge = Math.min(Math.abs(lateral), this.halfWidth);
  const out = Math.abs(lateral) - this.halfWidth;
  return f.y + Math.sign(lateral) * edge * Math.tan(f.bank) - (out > 0 ? out * APRON_DROP : 0);
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
  this.hint = s;
  const f = this.frame(s);
  return { s, lateral: (x - f.x) * f.ox + (z - f.z) * f.oz, tx: f.tx, tz: f.tz };
 }

 heightAt(x: number, z: number): number {
  const { s, lateral } = this.locate(x, z);
  return this.heightOn(this.frame(s), lateral);
 }

 surfaceAt(x: number, z: number): Surface {
  const a = Math.abs(this.locate(x, z).lateral);
  return a <= this.halfWidth ? 'road' : a <= this.halfWidth + KERB_BAND ? 'kerb' : 'ground';
 }

 hit(x: number, z: number, radius: number) {
  const { s, lateral } = this.locate(x, z);
  const depth = Math.abs(lateral) + radius - (this.halfWidth + WALL_GAP);
  if (depth <= 0) return null;
  const f = this.frame(s), side = Math.sign(lateral) || 1;
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
