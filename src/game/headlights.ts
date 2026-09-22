import * as THREE from 'three';
import type { Occluders } from './occlusion.ts';

/** Frames between two checks: five short rays is cheap, sixty times a second is pointless. */
export const CHECK_EVERY = 10;
/** How far up the probe starts, so the car's own body is never what blocks the sky. */
const PROBE_UP = 1.6;
/** Nothing further away than this roofs a car in any useful sense. */
const REACH = 90;
/** Share of the sky that has to be shut out before the lamps come on, and let back in to go off. */
const DARK = 0.6, LIGHT = 0.35;
/** Agreeing checks needed before the lamps actually switch, so an entrance does not strobe. */
export const HOLD = 2;

/**
 * Where the probe looks: straight up and four leans off the vertical. Asking whether the sun is
 * blocked is the wrong question - a palm blocks the sun, and the lamps were coming on for every
 * stand of trees on the island. A roof is what wants headlights, so the question is how much of
 * the sky is shut out.
 */
const SKY = [
 new THREE.Vector3(0, 1, 0),
 new THREE.Vector3(0.57, 0.82, 0),
 new THREE.Vector3(-0.57, 0.82, 0),
 new THREE.Vector3(0, 0.82, 0.57),
 new THREE.Vector3(0, 0.82, -0.57),
].map(v => v.normalize());

const ray = new THREE.Raycaster();
const from = new THREE.Vector3();
const to = new THREE.Vector3();

/** How much of the sky is shut out above the car, from 0 (open) to 1 (roofed). */
export function skyBlocked(car: THREE.Vector3, occluders: Occluders): number {
 if (!occluders.size) return 0;
 from.set(car.x, car.y + PROBE_UP, car.z);
 let blocked = 0;
 for (const direction of SKY) {
  to.copy(from).addScaledVector(direction, REACH);
  ray.set(from, direction);
  ray.far = REACH;
  if (ray.intersectObjects(occluders.along(from, to), true).length) blocked++;
 }
 return blocked / SKY.length;
}

/**
 * Whether the lamps should be on, given what they are doing now.
 *
 * Two thresholds rather than one: a car has to be well under a roof to switch them on and well
 * out from under it to switch them off, so a tunnel mouth does not flick them on and off as the
 * nose goes in.
 */
export const wantsLight = (blocked: number, lit: boolean): boolean => (lit ? blocked > LIGHT : blocked >= DARK);
