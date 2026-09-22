import * as THREE from 'three';
import type { CarState } from '../physics/types.js';

export type Spawn = { x: number; z: number; yaw: number };

type DebugWindow = Window & {
 __openSpeed?: unknown;
 __pick?: (x: number, y: number) => unknown;
 __cast?: (dx: number, dy: number, dz: number) => unknown;
 __walls?: (from: number, to: number, step?: number) => unknown;
};

/** The parts of the game the wall probe needs; it is a debug tool, so it asks loosely. */
type WallProbeHost = {
 world?: {
  length?: number;
  frames?: { left: number; right: number }[];
  track?: { step: number };
  surfacePoint?: (s: number, lateral: number) => { x: number; y: number; z: number };
 };
 drive?: { track?: { occluders?: { along(a: THREE.Vector3, b: THREE.Vector3): THREE.Object3D[] } } };
};

/** How far out the wall probe looks, and how high above the road it fires. */
const REACH = 60, PROBE_UP = 1.2;

const params = () => new URLSearchParams(location.search);

/** three.js raycasts hidden objects too; a pick is about what is on screen, so drop those. */
const shown = (object: THREE.Object3D): boolean => {
 for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
 return true;
};
const round = (value: number, scale: number) => Math.round(value * scale) / scale;

export function debugSpawn(): Spawn | undefined {
 const values = params().get('spawn')?.split(',').map(Number);
 if (!values || values.length < 2 || !values.every(Number.isFinite)) return undefined;
 return { x: values[0], z: values[1], yaw: (values[2] ?? 0) * Math.PI / 180 };
}

export const debugLaps = () => Number(params().get('laps')) || undefined;

export function exposeDebug(game: unknown, scene: () => THREE.Scene | undefined, camera: THREE.Camera, body: () => CarState) {
 if (!params().has('debug')) return;
 const target = window as DebugWindow;
 const root = () => scene()?.children ?? [];
 target.__openSpeed = game;
 target.__pick = (x, y) => {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  return ray.intersectObjects(root(), true).filter(hit => shown(hit.object)).slice(0, 6).map(hit => ({
   ...describe(hit),
   distance: round(hit.distance, 10),
   point: hit.point.toArray().map(v => round(v, 10)),
   // The surface's own direction, which is what decides how a thing placed here should sit.
   normal: worldNormal(hit).toArray().map(v => round(v, 100)),
  }));
 };
 /**
  * Where the drawn wall actually is, against where the collision thinks it is.
  *
  * The two are different things: the corridor comes from the source track's own drivable limits,
  * while the wall you see is the mesh. Where the corridor is wider than the rock, a car drives
  * through the rock and ends up outside the world; where it is tighter, the car catches on
  * nothing. This walks a stretch of the loop and reports both, in metres.
  */
 target.__walls = (from, to, step = 10) => {
  const host = game as WallProbeHost;
  const world = host.world;
  const occluders = host.drive?.track?.occluders;
  if (!world?.surfacePoint || !world.frames || !world.track || !occluders) return 'no road world';
  const ray = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const target3 = new THREE.Vector3();
  const rows: Record<string, number>[] = [];
  for (let s = from; s <= to; s += step) {
   const centre = world.surfacePoint(s, 0);
   const frame = world.frames[Math.round(s / world.track.step) % world.frames.length];
   const row: Record<string, number> = { s: round(s, 1), limitL: round(frame.left, 10), limitR: round(frame.right, 10) };
   for (const side of [-1, 1] as const) {
    const edge = world.surfacePoint(s, side * REACH);
    // Cast along the road's own lateral direction, a little above the surface.
    origin.set(centre.x, centre.y + PROBE_UP, centre.z);
    target3.set(edge.x, edge.y + PROBE_UP, edge.z);
    const direction = target3.clone().sub(origin);
    const far = direction.length();
    ray.set(origin, direction.normalize());
    ray.far = far;
    const hit = ray.intersectObjects(occluders.along(origin, target3), true)[0];
    row[side < 0 ? 'wallL' : 'wallR'] = hit ? round(hit.distance, 10) : -1;
   }
   rows.push(row);
  }
  return rows;
 };

 target.__cast = (dx, dy, dz) => {
  const s = body();
  const ray = new THREE.Raycaster(new THREE.Vector3(s.x, s.y, s.z), new THREE.Vector3(dx, dy, dz).normalize(), 0, 60);
  return ray.intersectObjects(root(), true).filter(hit => shown(hit.object)).slice(0, 3).map(hit => ({ ...describe(hit), distance: round(hit.distance, 100) }));
 };
}

const normalMatrix = new THREE.Matrix3();
const normal = new THREE.Vector3();

/** A hit's surface normal in world space; the face normal is stored in the object's own space. */
function worldNormal(hit: THREE.Intersection): THREE.Vector3 {
 if (!hit.face) return normal.set(0, 1, 0);
 normalMatrix.getNormalMatrix(hit.object.matrixWorld);
 return normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
}

const describe = (hit: THREE.Intersection) => ({ name: hit.object.name || '(anon)', parent: hit.object.parent?.name || '' });
