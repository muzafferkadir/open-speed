import * as THREE from 'three';
import type { Occluders } from '../game/occlusion.js';
import type { RoadWorld } from '../physics/RoadWorld.js';

/**
 * Measures where the track's drawn walls actually are, so the collision can agree with them.
 *
 * The physics knows the corridor the source ships - its own drivable width - and the renderer
 * knows the rock. Across Last Resort those two disagree by up to twenty metres in both
 * directions: where the corridor is wider a car drives through the rock and ends up outside the
 * world, and where it is tighter the car catches on nothing. This casts one ray each way per
 * frame and hands the physics the numbers; the measuring lives here because raycasting is
 * three's job and the physics has no three in it.
 */

/** How far out a wall is looked for, in metres; past this the section counts as open. */
const REACH = 60;
/** How high above the road the ray is fired, so a kerb is not read as a wall. */
const PROBE_UP = 1.2;

const origin = new THREE.Vector3();
const towards = new THREE.Vector3();
const direction = new THREE.Vector3();
const ray = new THREE.Raycaster();

/** Distance from the centre line to the first wall on each side, per frame; -1 where there is none. */
export function measureWalls(world: RoadWorld, occluders: Occluders): { left: Float32Array; right: Float32Array } {
 const count = world.frames.length;
 const left = new Float32Array(count).fill(-1);
 const right = new Float32Array(count).fill(-1);
 if (!occluders.size) return { left, right };
 const step = world.track.step;
 for (let i = 0; i < count; i++) {
  const s = i * step;
  const centre = world.surfacePoint(s, 0);
  origin.set(centre.x, centre.y + PROBE_UP, centre.z);
  for (const side of [-1, 1] as const) {
   const edge = world.surfacePoint(s, side * REACH);
   towards.set(edge.x, edge.y + PROBE_UP, edge.z);
   direction.copy(towards).sub(origin);
   const far = direction.length();
   if (far < 1) continue;
   ray.set(origin, direction.divideScalar(far));
   ray.far = far;
   const hit = ray.intersectObjects(occluders.along(origin, towards), true)[0];
   if (hit) (side < 0 ? left : right)[i] = hit.distance;
  }
 }
 return { left, right };
}
