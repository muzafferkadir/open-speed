// Three.js meshes for the banked oval: asphalt ribbon, aprons, walls, start line, and the
// high-desert setting around it: dry flats, a ring of distant mesas and a grandstand on the
// front straight.

import * as THREE from 'three';
import { surfaceTexture } from './SurfaceTexture.ts';
import type { OvalWorld } from '../physics/OvalWorld.ts';

const APRON = 120;
/** Distant hill ring: inner foot, crest and outer foot radii from the track centre (m). */
const HILLS_FOOT = 1100, HILLS_CREST = 1700, HILLS_OUTER = 2600, HILLS_SEGMENTS = 256;
/** Buttes around the ring: each one holds a single height across its own sector. */
const HILLS_BUTTES = 29;
/** Grandstand on the outside of the front straight: track metres and tier geometry. */
const STAND_FROM = 30, STAND_TO = 190, STAND_GAP = 4, TIERS = 9, TIER_DEPTH = 2.6, TIER_RISE = 1.1;

function ribbon(world: OvalWorld, inner: number, outer: number, lift = 0): THREE.BufferGeometry {
 const pos: number[] = [], uv: number[] = [], idx: number[] = [];
 const n = world.frames.length, step = world.track.step;
 for (let i = 0; i <= n; i++) {
  const s = (i % n) * step;
  const a = world.surfacePoint(s, inner), b = world.surfacePoint(s, outer);
  pos.push(a.x, a.y + lift, a.z, b.x, b.y + lift, b.z);
  uv.push(0, s / 12, 1, s / 12);
  if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx);
 g.computeVertexNormals();
 return g;
}

function wall(world: OvalWorld, lateral: number, height: number, base = 0): THREE.BufferGeometry {
 const pos: number[] = [], uv: number[] = [], idx: number[] = [];
 const n = world.frames.length, step = world.track.step;
 for (let i = 0; i <= n; i++) {
  const s = (i % n) * step, p = world.surfacePoint(s, lateral);
  pos.push(p.x, p.y + base, p.z, p.x, p.y + height, p.z);
  uv.push(s / 6, 0, s / 6, 1);
  if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx);
 g.computeVertexNormals();
 return g;
}

/** Concrete barrier paint: tyre-scuffed base, white body, red top band. Repeats along the wall. */
function barrierTexture(): THREE.CanvasTexture {
 const c = document.createElement('canvas');
 c.width = 256; c.height = 64;
 const ctx = c.getContext('2d')!;
 ctx.fillStyle = '#e9e9e4'; ctx.fillRect(0, 0, 256, 64);
 ctx.fillStyle = '#5a5551'; ctx.fillRect(0, 0, 256, 10);          // scuffed base (canvas top = wall base)
 ctx.fillStyle = '#c8322b'; ctx.fillRect(0, 52, 256, 12);         // red top band
 ctx.fillStyle = 'rgba(0,0,0,.08)';
 for (let x = 0; x < 256; x += 64) ctx.fillRect(x, 10, 2, 42);   // panel joints
 const tex = new THREE.CanvasTexture(c);
 tex.colorSpace = THREE.SRGBColorSpace;
 tex.wrapS = THREE.RepeatWrapping;
 return tex;
}

/** Solid barrier: track face at `lateral` (where the physics wall is), top slab and back face. */
function barrier(world: OvalWorld, lateral: number, thickness: number, height: number, paint: THREE.Material): THREE.Group {
 const g = new THREE.Group();
 const side = Math.sign(lateral), back = lateral + side * thickness;
 const front = new THREE.Mesh(wall(world, lateral, height, -.3), paint);
 const rear = new THREE.Mesh(wall(world, back, height, -.3), paint);
 const top = new THREE.Mesh(ribbon(world, Math.min(lateral, back), Math.max(lateral, back), height), new THREE.MeshStandardMaterial({ color: 0xd9d9d3, roughness: .85 }));
 for (const m of [front, rear, top]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
 return g;
}

/** Quad strip along the track between s0..s1, from edge A (lateral, lift) to edge B. */
/** Metres of a strip one copy of its texture covers along the track. */
const STRIP_TILE = 4;

function strip(world: OvalWorld, s0: number, s1: number, a: [number, number], b: [number, number], step = 4): THREE.BufferGeometry {
 const pos: number[] = [], uv: number[] = [], idx: number[] = [];
 const n = Math.max(1, Math.ceil((s1 - s0) / step));
 for (let i = 0; i <= n; i++) {
  const s = s0 + (s1 - s0) * i / n;
  const p = world.surfacePoint(s, a[0]), q = world.surfacePoint(s, b[0]);
  pos.push(p.x, p.y + a[1], p.z, q.x, q.y + b[1], q.z);
  uv.push(s / STRIP_TILE, 0, s / STRIP_TILE, 1);
  if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx);
 g.computeVertexNormals();
 return g;
}

/**
 * A packed crowd, painted rather than modelled: at the distance the stand is ever seen from, rows
 * of small colour blocks read as people and an empty maroon bench reads as nothing at all.
 */
function crowdTexture(): THREE.CanvasTexture {
 const size = 64, rows = 5, perRow = 22;
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = size;
 const ctx = canvas.getContext('2d')!;
 ctx.fillStyle = '#5c2721';
 ctx.fillRect(0, 0, size, size);
 const shirts = ['#d8d3c8', '#2f4f7a', '#8f2f2f', '#c9a227', '#3f6b4a', '#6b4a7a', '#e0e0e0', '#404652'];
 let seed = 5171;
 const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
 for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++) {
  const x = (i + (r % 2 ? 0.5 : 0)) * (size / perRow), y = size - (r + 1) * (size / rows) + rnd() * 2;
  ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
  ctx.fillRect(x, y + 3, size / perRow - 0.6, size / rows - 3);
  ctx.fillStyle = `hsl(28,${25 + rnd() * 20}%,${45 + rnd() * 30}%)`;
  ctx.fillRect(x + 0.6, y, size / perRow - 2, 3);
 }
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 return texture;
}

/** Stepped concrete grandstand outside the wall, with a back wall and a flat roof on posts. */
function grandstand(world: OvalWorld, hw: number): THREE.Group {
 const group = new THREE.Group();
 const concrete = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: .95, side: THREE.DoubleSide });
 const seats = new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: .85, side: THREE.DoubleSide });
 // The risers are what make a stand read as steps rather than as a ramp: from the track the tiers
 // are seen almost edge on, so if they are the same tone as the treads the whole thing is a bank.
 const riserMat = new THREE.MeshStandardMaterial({ color: 0x6b665e, roughness: .95, side: THREE.DoubleSide });
 const roofMat = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: .7, metalness: .1, side: THREE.DoubleSide });
 const base = hw + STAND_GAP, top = TIERS * TIER_RISE;
 // the wall sits on the banked apron, so lift everything to the outer wall's height
 for (let k = 0; k < TIERS; k++) {
  const l0 = base + k * TIER_DEPTH, l1 = l0 + TIER_DEPTH, y = (k + 1) * TIER_RISE;
  // The crowd goes on the risers, not the treads. From the track a stand is seen nearly edge on:
  // the treads are slivers and the risers are the face, so painting people on the flat surfaces
  // put them where nobody can see them and left the stand looking like a quarry.
  const tread = new THREE.Mesh(strip(world, STAND_FROM, STAND_TO, [l0, y], [l1, y]), riserMat);
  const riser = new THREE.Mesh(strip(world, STAND_FROM, STAND_TO, [l0, y - TIER_RISE], [l0, y]), seats);
  tread.receiveShadow = riser.receiveShadow = true;
  group.add(tread, riser);
 }
 const back = base + TIERS * TIER_DEPTH;
 group.add(new THREE.Mesh(strip(world, STAND_FROM, STAND_TO, [back, 0], [back, top + 3.5]), concrete));
 for (const s of [STAND_FROM, STAND_TO]) group.add(new THREE.Mesh(strip(world, s, s + .4, [base, 0], [back, top + 3.5]), concrete));
 const roof = new THREE.Mesh(strip(world, STAND_FROM - 2, STAND_TO + 2, [base - 1, top + 4.5], [back + 1, top + 5.5]), roofMat);
 roof.castShadow = true;
 group.add(roof);
 const post = new THREE.CylinderGeometry(.18, .18, top + 4.5, 8);
 for (let s = STAND_FROM; s <= STAND_TO; s += 20) {
  const p = world.surfacePoint(s, base + .6);
  const m = new THREE.Mesh(post, roofMat);
  m.position.set(p.x, p.y + (top + 4.5) / 2, p.z);
  group.add(m);
 }
 return group;
}

/**
 * The mesa cross-section, from the foot to the crest: how far along the radius each ring sits and
 * how high it stands, both as fractions. The steep middle is the wall and the last two rings share
 * a height, which is the flat top that makes a butte a butte.
 */
const MESA_PROFILE: readonly (readonly [number, number])[] = [
 [0, 0],
 [0.22, 0.22],
 [0.44, 0.92],
 [0.58, 1],
 [1, 0.97],
];

/**
 * Ring of mesas around the track. The profile is what makes a mesa read as one: a talus slope at
 * the foot, a steep wall, then a flat top that holds its height across the crest before the far
 * side falls away. A single crest ring - what this drew before - gives smooth dunes instead, which
 * is not what high desert looks like.
 *
 * Each ring carries its own colour, so the wall is bare rock and the top catches the sun.
 */
function hills(cx: number, cz: number, ground: number): THREE.Mesh {
 const pos: number[] = [], col: number[] = [], idx: number[] = [];
 const flats = new THREE.Color('#a99a72'), talus = new THREE.Color('#9d7a56');
 const wall = new THREE.Color('#8f6544'), rim = new THREE.Color('#c29a6e'), top = new THREE.Color('#b78f66');
 const seed = [1.7, 4.3, 2.9];
 const profile = MESA_PROFILE.map(([at, lift], i) => [at, lift, [flats, talus, wall, rim, top][i]] as const);
 const rings = profile.length + 1;
 for (let i = 0; i <= HILLS_SEGMENTS; i++) {
  const t = (i % HILLS_SEGMENTS) / HILLS_SEGMENTS * Math.PI * 2;
  // One height per butte, held across its whole sector: that is what gives a mesa its flat top
  // and the steep wall where it meets its neighbour. A height that varies smoothly with the angle,
  // which is what this did before, can only ever draw dunes.
  const sector = Math.floor((i % HILLS_SEGMENTS) / HILLS_SEGMENTS * HILLS_BUTTES);
  let n = 0.5 + 0.5 * Math.sin(sector * 5 + seed[0]);
  n *= 0.55 + 0.45 * Math.sin(sector * 11 + seed[1]);
  n += 0.25 * Math.abs(Math.sin(sector * 23 + seed[2]));
  const height = 40 + 230 * Math.min(1, n);
  const crest = HILLS_CREST + 250 * Math.sin(sector * 7 + seed[1]);
  const span = crest - HILLS_FOOT;
  for (const [at, lift, color] of profile) {
   pos.push(cx + Math.cos(t) * (HILLS_FOOT + span * at), ground + height * lift, cz + Math.sin(t) * (HILLS_FOOT + span * at));
   col.push(color.r, color.g, color.b);
  }
  // The far side melts into the fog rather than ending on a cliff edge.
  pos.push(cx + Math.cos(t) * HILLS_OUTER, ground + height * 0.3, cz + Math.sin(t) * HILLS_OUTER);
  col.push(wall.r, wall.g, wall.b);
  if (i < HILLS_SEGMENTS) {
   const o = i * rings;
   for (let r = 0; r < rings - 1; r++) {
    const a = o + r, b = a + rings;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
   }
  }
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
 g.setIndex(idx);
 g.computeVertexNormals();
 return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
}

function startLine(world: OvalWorld, halfWidth: number): THREE.Mesh {
 const pos: number[] = [], uv: number[] = [], idx: number[] = [];
 for (let i = 0; i <= 4; i++) {
  const s = i * 1.5;
  const a = world.surfacePoint(s, -halfWidth), b = world.surfacePoint(s, halfWidth);
  pos.push(a.x, a.y + 0.04, a.z, b.x, b.y + 0.04, b.z);
  uv.push(i / 4, 0, i / 4, 1);
  if (i < 4) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx);
 g.computeVertexNormals();
 const c = document.createElement('canvas');
 c.width = 128; c.height = 16;
 const ctx = c.getContext('2d')!;
 ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 16);
 ctx.fillStyle = '#15171b';
 for (let i = 0; i < 16; i++) ctx.fillRect(i * 8, i % 2 ? 0 : 8, 8, 8);
 const tex = new THREE.CanvasTexture(c);
 tex.colorSpace = THREE.SRGBColorSpace;
 return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: .5, side: THREE.DoubleSide }));
}

/** Side of the desert floor, in metres. */
const GROUND_SIZE = 20000;
/** Metres of desert one repeat of the floor grain covers. */
const GROUND_TILE = 50;

export class OvalScene {
 static build(world: OvalWorld): { group: THREE.Group; circuit: THREE.Vector3[] } {
  const group = new THREE.Group();
  const hw = world.halfWidth;
  const asphalt = surfaceTexture('asphalt');
  asphalt.repeat.set(3, 1);
  const road = new THREE.Mesh(ribbon(world, -hw, hw), new THREE.MeshStandardMaterial({ map: asphalt, color: '#4a4e54', roughness: .94 }));
  road.receiveShadow = true;
  group.add(road);
  // The ribbon's u runs 0..1 across the whole apron, so one copy of the grain was smeared over
  // 120 m of ground; v already repeats every 12 m, and across the width it now matches.
  const apronGrain = surfaceTexture('ground');
  apronGrain.repeat.set(APRON / 12, 1);
  const grass = new THREE.MeshStandardMaterial({ map: apronGrain, color: '#a49a6a', roughness: 1 });
  for (const [a, b] of [[hw, hw + APRON], [-hw - APRON, -hw]] as const) {
   const apron = new THREE.Mesh(ribbon(world, a, b), grass);
   apron.receiveShadow = true;
   group.add(apron);
  }
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: .55 });
  group.add(new THREE.Mesh(ribbon(world, hw - .8, hw - .3, .02), white));
  group.add(new THREE.Mesh(ribbon(world, -hw + .3, -hw + .8, .02), white));
  const paint = new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: .85, side: THREE.DoubleSide });
  group.add(barrier(world, hw + .5, .45, 1.25, paint));
  group.add(barrier(world, -hw - .5, .45, 1.0, paint));
  group.add(startLine(world, hw));
  const low = Math.min(...world.frames.map(f => f.y));
  // The desert floor is 20 km across; a flat colour reads as a painted backdrop, so it carries
  // the same grain the aprons do, tiled at about 50 m so the scale matches a car.
  const floor = surfaceTexture('ground');
  floor.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new THREE.MeshStandardMaterial({ map: floor, color: '#a99a72', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = low - 14;
  group.add(ground);
  const cx = world.frames.reduce((a, f) => a + f.x, 0) / world.frames.length, cz = world.frames.reduce((a, f) => a + f.z, 0) / world.frames.length;
  group.add(hills(cx, cz, low - 14));
  group.add(grandstand(world, hw));
  const circuit = world.frames.map(f => new THREE.Vector3(f.x, f.y, f.z));
  return { group, circuit };
 }
}
