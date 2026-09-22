// Three.js meshes for a route built from the source track data. When the baked
// track mesh is available (`assets/maps/<id>-track.glb`, scripts/extract-track.mjs) it
// replaces the invented surfaces; the generated ribbons remain as the fallback and as the
// physics-aligned reference the tests measure.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { asphaltTile, asphaltRoughTile, asphaltNormalTile, markingMask, tileMean, vergeTile, type MarkingMask, type Rgb } from './roadSurface.ts';
import { surfaceTexture } from './SurfaceTexture.ts';
import type { RoadWorld } from '../physics/RoadWorld.ts';

/** Widest asphalt half-width drawn; wider source corridors are open ground. */
const ROAD_MAX = 11.5;
/** Kerb strip outside the asphalt, metres. */
const KERB = 1.1;
/** Shoulder skirt outside the collision limit, metres. */
const SKIRT = 30;
/** Ground field cell, metres. */
const FIELD = 40;
/** A corridor wider than this is an open section: no barrier line is drawn. */
const OPEN = 30;
/** Edge of the generated road/verge tiles, texels. */
const TILE = 512;
/**
 * Source tiles the runtime re-renders: the road family, keyed by the source texNumber
 * the GLB materials are named after. `track` is the wheel path across the tile (u = across the
 * road, measured with the map's lateral axis); 278/280 are the left pavement (u = 1 at the spine),
 * 279/281 the right, and 276 the centre band that needs no single track.
 */
const ROAD_TILES: Record<number, { track: number | null }> = {
 276: { track: null },
 278: { track: 0.72 }, 280: { track: 0.72 },
 279: { track: 0.28 }, 281: { track: 0.28 },
};
/** Shoulder/apron tiles that get a sand-to-grass gradient instead of the source's flat band. */
const VERGE_TILES = new Set([129, 130]);

type Frame = RoadWorld['frames'][number];

export class RoadScene {
 readonly group = new THREE.Group();
 /** Generated surfaces that the baked track mesh supersedes. */
 readonly placeholder = new THREE.Group();
 readonly circuit: THREE.Vector3[];

 private constructor(world: RoadWorld) {
  this.circuit = world.circuit.map(([x, z]) => new THREE.Vector3(x, world.heightAt(x, z) + 1, z));
  this.placeholder.name = 'generated-surfaces';
 }

 /** The baked textured geometry is in play: drop the generated stand-ins. */
 useTrackMesh(): void { this.placeholder.visible = false; }

 /** Load the baked track mesh; null when it is not present. */
 static async loadTrackMesh(url: string): Promise<THREE.Group | null> {
  try {
   const gltf = await new GLTFLoader().loadAsync(url);
   const group = gltf.scene;
   group.name = 'track-mesh';
   group.traverse(o => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    // The track casts too: without it the canyon walls and the cuttings throw nothing and the
    // whole route is lit as if the sun reached every part of it equally.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
   });
   faceForward(group);
   upgradeRoadMaterials(group);
   return group;
  } catch (error) {
   console.warn('Track mesh not loaded:', error);
   return null;
  }
 }

 static build(world: RoadWorld): RoadScene {
  const scene = new RoadScene(world), group = scene.group, placeholder = scene.placeholder;
  group.add(placeholder);
  const ground = surfaceTexture('ground');
  const asphaltHalf = (f: Frame) => [Math.min(f.left, ROAD_MAX), Math.min(f.right, ROAD_MAX)] as [number, number];

  placeholder.add(track(new THREE.Mesh(band(world, (_, f) => [-asphaltHalf(f)[0], asphaltHalf(f)[1]]),
   new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: .95, metalness: .02 }))));

  const kerb = new THREE.MeshStandardMaterial({ color: 0xd9d6cd, roughness: .9 });
  const sand = new THREE.MeshStandardMaterial({ map: ground, color: 0xb9a882, roughness: 1 });
  const skirt = new THREE.MeshStandardMaterial({ map: ground, color: 0x9d9578, roughness: 1 });
  for (const side of [-1, 1] as const) {
   const half = (f: Frame) => (side < 0 ? f.left : f.right);
   placeholder.add(bandMesh(world, (_, f) => {
    const h = Math.min(half(f), ROAD_MAX);
    return side < 0 ? [-(h + KERB), -h] : [h, h + KERB];
   }, 0.06, kerb));
   // ground between the kerb and the collision limit, then the skirt that hides the void
   placeholder.add(bandMesh(world, (_, f) => {
    const h = half(f), inner = Math.min(h, ROAD_MAX) + KERB;
    return side < 0 ? [-h, -inner] : [inner, h];
   }, 0, sand));
   placeholder.add(bandMesh(world, (_, f) => {
    const inner = half(f) + KERB;
    return side < 0 ? [-(inner + SKIRT), -inner] : [inner, inner + SKIRT];
   }, 0, skirt));
  }

  // The collision wall only cues the invisible source limit in the generated stand-in world; with
  // the baked mesh the scenery itself marks the edges.
  const barrier = new THREE.Mesh(barriers(world), new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: .85 }));
  barrier.name = 'collision-wall';
  placeholder.add(barrier);
  const field = new THREE.Mesh(groundField(world), new THREE.MeshStandardMaterial({ map: ground, color: 0x9aa178, roughness: 1, vertexColors: true }));
  field.name = 'ground-field';
  placeholder.add(field);
  placeholder.add(new THREE.Mesh(finishLine(world), new THREE.MeshStandardMaterial({ color: 0xf4f2ea, roughness: .8 })));
  return scene;
 }
}

/** Quad strip between two lateral edges, one row per source record, wrapped closed. */
function band(world: RoadWorld, edge: (i: number, f: Frame) => [number, number], lift = 0): THREE.BufferGeometry {
 const pos: number[] = [], uv: number[] = [], idx: number[] = [];
 const frames = world.frames, n = frames.length, step = world.track.step;
 for (let i = 0; i <= n; i++) {
  const k = i % n, s = k * step, f = frames[k];
  const [a, b] = edge(k, f);
  const pa = world.surfacePoint(s, a), pb = world.surfacePoint(s, b);
  pos.push(pa.x, pa.y + lift, pa.z, pb.x, pb.y + lift, pb.z);
  uv.push(0, s / 8, 1, s / 8);
  if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
 }
 return geometry(pos, uv, idx);
}

function bandMesh(world: RoadWorld, edge: (i: number, f: Frame) => [number, number], lift: number, material: THREE.Material): THREE.Mesh {
 const mesh = new THREE.Mesh(band(world, edge, lift), material);
 mesh.receiveShadow = true;
 return mesh;
}

function track(mesh: THREE.Mesh): THREE.Mesh {
 mesh.receiveShadow = true;
 mesh.name = 'road-surface';
 return mesh;
}

/** Start/finish band across the drivable width. */
function finishLine(world: RoadWorld): THREE.BufferGeometry {
 const pos: number[] = [], uv: number[] = [], idx: number[] = [];
 const span = 2.4, rows = 7;
 for (let i = 0; i <= rows; i++) {
  const s = -span / 2 + span * (i / rows);
  const f = world.frames[(i + world.frames.length) % world.frames.length];
  const a = world.surfacePoint(s, -Math.min(f.left, ROAD_MAX)), b = world.surfacePoint(s, Math.min(f.right, ROAD_MAX));
  pos.push(a.x, a.y + 0.02, a.z, b.x, b.y + 0.02, b.z);
  uv.push(0, i / rows, 1, i / rows);
  if (i < rows) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
 }
 return geometry(pos, uv, idx);
}

/** Vertical barrier face along the collision limit, one quad per segment, skipped in open sections. */
function barriers(world: RoadWorld): THREE.BufferGeometry {
 const HEIGHT = 1.1, pos: number[] = [], uv: number[] = [], idx: number[] = [];
 const frames = world.frames, n = frames.length, step = world.track.step;
 let v = 0;
 for (const side of [-1, 1] as const) {
  for (let i = 0; i < n; i++) {
   const a = frames[i], b = frames[(i + 1) % n];
   const openA = (a.left + a.right) / 2 > OPEN, openB = (b.left + b.right) / 2 > OPEN;
   if (openA || openB) continue;
   const la = side * ((side < 0 ? a.left : a.right) + KERB), lb = side * ((side < 0 ? b.left : b.right) + KERB);
   const pa = world.surfacePoint(i * step, la), pb = world.surfacePoint(((i + 1) % n) * step, lb);
   pos.push(pa.x, pa.y, pa.z, pa.x, pa.y + HEIGHT, pa.z, pb.x, pb.y, pb.z, pb.x, pb.y + HEIGHT, pb.z);
   uv.push(i / 4, 0, i / 4, 1, (i + 1) / 4, 0, (i + 1) / 4, 1);
   idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
   v += 4;
  }
 }
 return geometry(pos, uv, idx);
}

/** Coarse ground around the route: the nearest spine height, dropped, so the track sits in land. */
function groundField(world: RoadWorld): THREE.BufferGeometry {
 const xs = world.frames.map(f => f.x), zs = world.frames.map(f => f.z);
 const minX = Math.min(...xs) - 300, maxX = Math.max(...xs) + 300;
 const minZ = Math.min(...zs) - 300, maxZ = Math.max(...zs) + 300;
 const nx = Math.ceil((maxX - minX) / FIELD) + 1, nz = Math.ceil((maxZ - minZ) / FIELD) + 1;
 const pos: number[] = [], uv: number[] = [], colors: number[] = [], idx: number[] = [];
 const color = new THREE.Color(), inlandC = new THREE.Color('#b9ab86');
 for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const x = minX + i * FIELD, z = minZ + j * FIELD;
  const near = world.locate(x, z);
  const y = world.heightAt(x, z) - 1.4 - Math.min(50, Math.abs(near.lateral) * 0.04);
  pos.push(x, y, z);
  uv.push(x / 14, z / 14);
  color.set('#87936a').lerp(inlandC, Math.min(1, Math.abs(near.lateral) / 200));
  colors.push(color.r, color.g, color.b);
 }
 for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
  const o = j * nx + i;
  idx.push(o, o + nx, o + 1, o + 1, o + nx, o + nx + 1);
 }
 const g = geometry(pos, uv, idx);
 g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
 return g;
}

/** Asphalt with edge lines and a dashed centre line; u runs across the road. */
function roadTexture(): THREE.CanvasTexture {
 const w = 128, h = 256;
 const canvas = document.createElement('canvas');
 canvas.width = w; canvas.height = h;
 const ctx = canvas.getContext('2d')!, image = ctx.createImageData(w, h);
 let seed = 7717;
 for (let i = 0; i < w * h; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const v = 96 + seed / 4294967296 * 46;
  image.data.set([v, v, v, 255], i * 4);
 }
 ctx.putImageData(image, 0, 0);
 ctx.fillStyle = '#e8e6de';
 ctx.fillRect(0, 0, 3, h);
 ctx.fillRect(w - 3, 0, 3, h);
 for (let y = 0; y < h; y += 32) ctx.fillRect((w >> 1) - 2, y, 4, 18);
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 texture.anisotropy = 4;
 return texture;
}

/** Renders a generated tile to a three.js texture; colour tiles are sRGB, the rest stay linear. */
function canvasTexture(tile: { width: number; height: number; rgba: Uint8ClampedArray }, srgb: boolean): THREE.CanvasTexture {
 const canvas = document.createElement('canvas');
 canvas.width = tile.width;
 canvas.height = tile.height;
 const ctx = canvas.getContext('2d')!;
 const image = ctx.createImageData(tile.width, tile.height);
 image.data.set(tile.rgba);
 ctx.putImageData(image, 0, 0);
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 texture.anisotropy = 8;
 return texture;
}

/** Reads a source tile back so the replacement keeps its colour, and lifts any painted line mask. */
function sampleSource(map: THREE.Texture | null): { mean: Rgb; mask?: MarkingMask } {
 const image = map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
 const width = image?.width ?? 0, height = image?.height ?? 0;
 if (!image || !width || !height) return { mean: [86, 86, 86] };
 const canvas = document.createElement('canvas');
 canvas.width = width;
 canvas.height = height;
 const ctx = canvas.getContext('2d')!;
 ctx.drawImage(image, 0, 0);
 const rgba = ctx.getImageData(0, 0, width, height).data;
 const source = { width, height, rgba };
 const mask = markingMask(source);
 return { mean: tileMean(source), mask: mask.columns.includes(true) || mask.rows.includes(true) ? mask : undefined };
}

const materialOf = (mesh: THREE.Mesh): THREE.MeshStandardMaterial | undefined => {
 const material = mesh.material;
 return Array.isArray(material) ? undefined : material as THREE.MeshStandardMaterial;
};

/** Higher-res asphalt matching the source tone, with a wheel-path sheen and a faint normal. */
function upgradeAsphalt(material: THREE.MeshStandardMaterial, id: number, track: number | null): void {
 const { mean, mask } = sampleSource(material.map);
 const seed = 101 + id, band = track ?? undefined;
 material.map = canvasTexture(asphaltTile({ size: TILE, tone: mean, seed, track: band, markings: mask }), true);
 material.roughnessMap = canvasTexture(asphaltRoughTile({ size: TILE, seed, track: band }), false);
 material.normalMap = canvasTexture(asphaltNormalTile({ size: TILE, seed }), false);
 material.normalScale = new THREE.Vector2(0.25, 0.25);
 material.roughness = 0.85;
 material.metalness = 0;
 material.needsUpdate = true;
}

/** Sand-to-grass gradient for the flat shoulder band, tinted by the source apron colour. */
function upgradeVerge(material: THREE.MeshStandardMaterial, id: number): void {
 const { mean } = sampleSource(material.map);
 const far: Rgb = [mean[0] * 0.88, mean[1] * 0.93, mean[2] * 0.78];
 material.map = canvasTexture(vergeTile({ size: 256, near: mean, far, seed: 211 + id }), true);
 material.roughness = 0.95;
 material.needsUpdate = true;
}

/**
 * The source ships 64-128 px flat tiles, which smear at speed. Swap them for the procedural
 * surfaces by the source texNumber the GLB materials carry (`tex-<n>`); the mesh, its UVs and the
 * physics surface are untouched, and no new bytes enter the GLB.
 */
/**
 * Turns the source geometry the right way out and gives it normals.
 *
 * It arrives with no normal attribute and its triangles wound both ways: of the 22,202 horizontal
 * faces on Last Resort, 18,459 face down and 3,743 face up. Three then flat-shades from screen-space
 * derivatives, which always face the camera, so a surface looks lit whichever way it points - until
 * something computes real normals, which come out pointing into the ground on most of it.
 *
 * Reversing every triangle fixed the majority and broke the rest: the 3,743 that were already right
 * turned away from the camera and were culled, which is the sawtooth of missing wedges along the
 * shoreline and the grass. So each triangle is turned by its own normal instead - a face with the
 * ground on one side of it points up - and the ones standing on edge, where there is no up to point
 * to, are left alone and drawn from both sides.
 */
const UPRIGHT = 0.35;

function faceForward(group: THREE.Group): void {
 const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
 const u = new THREE.Vector3(), v = new THREE.Vector3(), normal = new THREE.Vector3();
 // One pass per geometry: a node list that drew the same geometry twice would turn it back again.
 const turned = new Set<THREE.BufferGeometry>();
 group.traverse(object => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || turned.has(mesh.geometry)) return;
  turned.add(mesh.geometry);
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  if (index) {
   const order = index.array as Uint16Array | Uint32Array;
   for (let i = 0; i < order.length; i += 3) {
    a.fromBufferAttribute(position, order[i]);
    b.fromBufferAttribute(position, order[i + 1]);
    c.fromBufferAttribute(position, order[i + 2]);
    normal.copy(u.subVectors(b, a)).cross(v.subVectors(c, a));
    const length = normal.length();
    if (length < 1e-9) continue;
    // Standing on edge: which way it is wound says nothing, and both sides are drawn.
    if (Math.abs(normal.y / length) < UPRIGHT) continue;
    if (normal.y < 0) { const first = order[i]; order[i] = order[i + 2]; order[i + 2] = first; }
   }
   index.needsUpdate = true;
  }
  mesh.geometry.computeVertexNormals();
  const material = materialOf(mesh);
  if (material) {
   material.flatShading = false;
   // The source cannot be trusted to have wound its walls consistently either, and a wall that is
   // drawn from one side only is a hole in a cliff.
   material.side = THREE.DoubleSide;
   material.needsUpdate = true;
  }
 });
}

function upgradeRoadMaterials(group: THREE.Group): void {
 group.traverse(object => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  const material = materialOf(mesh);
  if (!material?.name.startsWith('tex-')) return;
  const id = Number(material.name.slice(4));
  if (ROAD_TILES[id]) upgradeAsphalt(material, id, ROAD_TILES[id].track);
  else if (VERGE_TILES.has(id)) upgradeVerge(material, id);
 });
}


/**
 * How level a surface is, from 0 (vertical) to 1 (flat), as the area-weighted mean of |n.y| over
 * its triangles. Read from the positions, because the source carries no normal attribute.
 */
export function levelness(geometry: THREE.BufferGeometry): number {
 const position = geometry.getAttribute('position');
 const index = geometry.getIndex();
 const count = index ? index.count : position.count;
 const at = (i: number) => (index ? index.getX(i) : i);
 const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
 let area = 0, level = 0;
 for (let i = 0; i + 2 < count; i += 3) {
  a.fromBufferAttribute(position, at(i));
  b.fromBufferAttribute(position, at(i + 1)).sub(a);
  c.fromBufferAttribute(position, at(i + 2)).sub(a);
  b.cross(c);
  const size = b.length();
  if (!size) continue;
  area += size;
  level += Math.abs(b.y);
 }
 return area ? level / area : 0;
}

function geometry(pos: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx);
 g.computeVertexNormals();
 return g;
}
