// World adapter around the arcade model: ground height/normal, surfaces, walls, water. The body
// is rigid (no suspension animation) but sits flat on the surface: pitch and
// roll follow the ground normal so the car leans with the banking instead of hanging over it.
// Body frame: yaw 0 = -Z, +steer = right. Fixed 64 Hz (TICK), no three.js.

import cars from '../data/arcade-cars.json' with { type: 'json' };
import { contact, respond, type Body } from './collision.ts';
import { createArcadeState, impactArcade, resetArcade, tickArcade, SURFACE_GRIP, TICK, type ArcadeData, type ArcadeState } from './Arcade.ts';
import type { CarInput, CarState, VehicleProfile, WheelState, World } from './types';

const BODY_RADIUS = 1.1;
/** Metres of bodywork past the axles at each end, and past the track on each side. */
const OVERHANG = 0.62, MIRRORS = 0.16;
/** Per tick fade of the knock the AI reacts to: about half a second to settle. */
const IMPACT_DECAY = 0.93;

/** Gravity, m/s^2. The arcade model has its own slope term; this one is for the time off the ground. */
const GRAVITY = 9.81;
/** The car has to clear the ground by this much for a crest to count as a launch, not a bump. */
const LAUNCH_CLEARANCE = 0.06;
/** Speed lost on landing, per m/s of the drop that was arriving; capped so a jump is not a stop. */
const LANDING_SCRUB = 0.012, LANDING_SCRUB_MAX = 0.25;
/** How fast the body's pitch chases the flight path while airborne, per tick. */
const AIR_PITCH_RATE = 0.12;
/** Wall contact is tested at the nose and the tail too, so the body cannot poke through a barrier. */
const CONTACT_OFFSET = 1.3, CONTACT_RADIUS = 0.95;
/** Below this speed (m/s) a car pinned against a wall gets its heading eased toward the wall line
 *  (rad per tick) so throttle can pull it out. Without it a nose-in stall would need reverse. */
const UNSTICK_SPEED = 3, UNSTICK_RATE = 0.02;
const HIT_ITER = 2;
const IDLE_RPM = 800;
const STEER_LOCK = 0.6;
/** Below this speed (m/s) the front wheels show the input; above it they show the car's own arc. */
const ROLLING = 6;
const SURFACE: Record<string, number> = { road: SURFACE_GRIP[0], kerb: SURFACE_GRIP[4], ground: SURFACE_GRIP[9] };

/** Body reference height at rest; the model sits at y=0. */
export const RIDE_HEIGHT = 0.485;
export const SUSP_TRAVEL = 0.28;
export const REST_COMPRESSION_FRONT = 0.52;
export const REST_COMPRESSION_REAR = 0.45;
export { TICK };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * One tick of a car that is off the ground: it keeps the velocity it left with and nothing else
 * happens to it. The arcade model is all engine, grip and slope, and none of those exist in mid-air -
 * running it while flying was accelerating the car on a road it was nowhere near.
 */
function coast(car: ArcadeState): void {
 car.x += car.vx * TICK;
 car.z += car.vz * TICK;
}
const DATA = cars as ArcadeData[];

export class Car {
 readonly state: CarState;
 private readonly world: World;
 private readonly profile: VehicleProfile;
 /** Decaying memory of the last knock; see CarState.impact. */
 private impactLevel = 0;
 /** Height of the body reference above the world, tracked so the car can leave the ground. */
 private height = 0;
 /** Vertical speed, m/s. Meaningful while airborne; on the ground it is the slope's own rise. */
 private climb = 0;
 private airborne = false;
 /** Body pitch while airborne: it follows the flight path, not a ground normal that is not there. */
 private airPitch = 0;
 private readonly arcade: ArcadeState;
 private readonly loop: [number, number][];
 private readonly cum: number[];
 private readonly wheels: WheelState[];

 constructor(profile: VehicleProfile, world: World) {
  this.profile = profile;
  this.world = world;
  const data = DATA.find(c => c.id === profile.arcade) ?? DATA.find(c => c.id === 'marl') ?? DATA[0];
  this.arcade = createArcadeState(data);
  this.loop = world.circuit ?? [];
  this.cum = [0];
  for (let i = 1; i < this.loop.length; i++)
   this.cum.push(this.cum[i - 1] + Math.hypot(this.loop[i][0] - this.loop[i - 1][0], this.loop[i][1] - this.loop[i - 1][1]));
  this.wheels = [0, 1, 2, 3].map(i => ({ contact: true, compression: i < 2 ? REST_COMPRESSION_FRONT : REST_COMPRESSION_REAR, spin: 0, steer: 0 }));
  this.state = {
   x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
   speed: 0, rpm: IDLE_RPM, rpmMax: data.redline, gear: 1, steerAngle: 0,
   slipFront: 0, slipRear: 0, wheels: this.wheels, distance: 0, impact: 0,
  };
  this.reset(0, 0, 0);
 }

 reset(x: number, z: number, yaw: number): void {
  resetArcade(this.arcade, x, z, yaw);
  for (const w of this.wheels) { w.spin = 0; w.steer = 0; w.contact = true; }
  this.airborne = false;
  this.climb = 0;
  this.airPitch = 0;
  this.height = this.world.heightAt(x, z) + RIDE_HEIGHT;
  this.impactLevel = 0;
  this.publish();
 }

 private normal(x: number, z: number) {
  const h = (px: number, pz: number) => this.world.heightAt(px, pz);
  const dx = (h(x + 1, z) - h(x - 1, z)) / 2, dz = (h(x, z + 1) - h(x, z - 1)) / 2;
  const l = Math.hypot(dx, 1, dz);
  return { x: -dx / l, y: 1 / l, z: -dz / l };
 }

 step(input: CarInput, _dt: number): void {
  const car = this.arcade, world = this.world;
  this.impactLevel *= IMPACT_DECAY;
  const heading = car.yaw;
  const preX = car.x, preZ = car.z;
  const surface = world.surfaceAt(car.x, car.z);
  const depth = world.waterDepthAt?.(car.x, car.z) ?? 0;
  const maxWade = world.maxWadeDepth ?? 0.6;
  const surf = (SURFACE[surface] ?? 1) * (1 - clamp(depth / maxWade, 0, 1) * 0.4);
  // Where the car sat before the tick: if this is the tick it leaves the ground, the crest's
  // ground model does not get to touch it. It has no grip to work with.
  const beforeFwd = car.vFwd, beforeX = car.vx, beforeZ = car.vz;
  if (this.airborne) coast(car);
  else tickArcade(car, { throttle: input.throttle, brake: input.brake, steer: input.steer, hand: input.handbrake, reverse: !!input.reverse }, this.normal(car.x, car.z), surf, world.curveAhead?.(car.x, car.z) ?? 0);

  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  for (let i = 0; i < HIT_ITER; i++) {
   let touched = false;
   for (const [off, radius] of [[0, BODY_RADIUS], [CONTACT_OFFSET, CONTACT_RADIUS], [-CONTACT_OFFSET, CONTACT_RADIUS]] as const) {
    const hit = world.hit(car.x + fx * off, car.z + fz * off, radius);
    if (!hit) continue;
    touched = true;
    const len = Math.hypot(hit.nx, hit.nz) || 1;
    const nx = hit.nx / len, nz = hit.nz / len;
    car.x += nx * hit.depth; car.z += nz * hit.depth;
    impactArcade(car, nx, nz);
    if (Math.abs(car.vFwd) < UNSTICK_SPEED) {
     // ease the heading toward whichever wall direction is closer to where the nose points
     const tx = -nz, tz = nx, dir = fx * tx + fz * tz >= 0 ? 1 : -1;
     const want = Math.atan2(-tx * dir, -tz * dir);
     const d = Math.atan2(Math.sin(want - car.yaw), Math.cos(want - car.yaw));
     car.yaw += clamp(d, -UNSTICK_RATE, UNSTICK_RATE);
    }
   }
   if (!touched) break;
  }
  const b = world.bounds;
  if (b) {
   let nx = 0, nz = 0;
   if (car.x < b.minX + BODY_RADIUS) { car.x = b.minX + BODY_RADIUS; nx = 1; }
   else if (car.x > b.maxX - BODY_RADIUS) { car.x = b.maxX - BODY_RADIUS; nx = -1; }
   if (car.z < b.minZ + BODY_RADIUS) { car.z = b.minZ + BODY_RADIUS; nz = 1; }
   else if (car.z > b.maxZ - BODY_RADIUS) { car.z = b.maxZ - BODY_RADIUS; nz = -1; }
   if (nx || nz) { const l = Math.hypot(nx, nz); impactArcade(car, nx / l, nz / l); }
  }
  const deep = (x: number, z: number) => world.waterDepthAt ? world.waterDepthAt(x, z) > maxWade : world.isWater?.(x, z) ?? false;
  if (deep(car.x, car.z)) {
   let lo = 0, hi = 1;
   const dx = car.x - preX, dz = car.z - preZ;
   for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (deep(preX + dx * mid, preZ + dz * mid)) hi = mid; else lo = mid; }
   car.x = preX + dx * lo; car.z = preZ + dz * lo;
   const s = (x: number, z: number) => world.waterDepthAt?.(x, z) ?? (deep(x, z) ? 1 : 0);
   let nx = s(car.x - 0.5, car.z) - s(car.x + 0.5, car.z), nz = s(car.x, car.z - 0.5) - s(car.x, car.z + 0.5);
   if (Math.hypot(nx, nz) < 1e-8) { nx = -dx; nz = -dz; }
   const l = Math.hypot(nx, nz) || 1;
   impactArcade(car, nx / l, nz / l);
  }

  if (this.fly(world.heightAt(car.x, car.z) + RIDE_HEIGHT)) {
   car.vFwd = beforeFwd; car.vx = beforeX; car.vz = beforeZ;
  }

  this.turnRate = Math.atan2(Math.sin(car.yaw - heading), Math.cos(car.yaw - heading)) / TICK;
  const spin = car.vFwd / this.profile.wheelRadius * TICK;
  for (let i = 0; i < 4; i++) {
   // In the air the wheels keep turning at the speed they left with; nothing is driving them.
   this.wheels[i].spin += spin;
   this.wheels[i].steer = i < 2 ? this.steerAngle(car) : 0;
   this.wheels[i].contact = !this.airborne;
  }
  this.publish();
 }

 /**
  * Where the front wheels are pointing.
  *
  * The input is a request, not an angle. At speed the car answers a fraction of it - that is what
  * a steering model is - so wheels drawn at the requested lock are wheels turning further than the
  * car they are bolted to, which is what it looks like: the fronts sawing away while the car eases
  * round. What they should show is the arc the car is actually on, and the bicycle model gives it:
  * tan(delta) = yaw rate x wheelbase / speed.
  *
  * That arithmetic has nothing to say about a car standing still, where the wheel can be turned
  * and no arc comes of it, so below `ROLLING` the request fades back in. Reversing keeps the
  * signed speed: wheels turned right send the tail right and the nose the other way.
  */
 private turnRate = 0;

 private steerAngle(car: ArcadeState): number {
  const asked = car.steer / 128 * STEER_LOCK;
  const speed = Math.abs(car.vFwd) < 1 ? 1 : car.vFwd;
  // The car's own turn rate, measured off its heading rather than read out of the driving model,
  // whose yaw figure is in its own units and counts the other way round.
  const arc = Math.atan(-this.turnRate * this.profile.wheelbase / speed);
  const rolling = Math.min(1, Math.abs(car.vFwd) / ROLLING);
  const angle = asked * (1 - rolling) + arc * rolling;
  return Math.max(-STEER_LOCK, Math.min(STEER_LOCK, angle));
 }

 /**
  * Lets the car leave the ground.
  *
  * The body used to be pinned to the surface height every tick, so a ramp was something the car
  * drove up and then stuck to on the way over the crest - flat out over a jump and the wheels
  * never left the road. Here the climb the ground was giving the car is carried on past the crest
  * under gravity, and the car only meets the surface again when the surface comes back up to it.
  */
 private fly(groundHeight: number): boolean {
  if (this.airborne) {
   this.climb -= GRAVITY * TICK;
   this.height += this.climb * TICK;
   // The nose follows the flight path: up while climbing, down while falling.
   const want = Math.atan2(this.climb, Math.max(4, Math.abs(this.arcade.vFwd)));
   this.airPitch += (want - this.airPitch) * AIR_PITCH_RATE;
   if (this.height > groundHeight) return false;
   // Landing scrubs some speed: the harder the fall, the more of it.
   this.arcade.vFwd *= 1 - Math.min(LANDING_SCRUB_MAX, Math.abs(this.climb) * LANDING_SCRUB);
   this.height = groundHeight;
   this.climb = 0;
   this.airborne = false;
   this.airPitch = 0;
   return false;
  }
  // On the ground the car climbs at whatever rate the slope under it was giving it. Carrying that
  // rate one tick forward is the test: where the ground can no longer keep up with it, the car is
  // already in the air. The rate has to be the one from the last tick - at a crest the ground has
  // dropped away, so measuring it now would only ever say the car is falling.
  const free = this.height + this.climb * TICK - 0.5 * GRAVITY * TICK * TICK;
  if (this.climb > 0 && free > groundHeight + LAUNCH_CLEARANCE) {
   this.airborne = true;
   this.airPitch = 0;
   this.height = free;
   return true;
  }
  this.climb = (groundHeight - this.height) / TICK;
  this.height = groundHeight;
  return false;
 }

 /** True while the car is off the ground. */
 get flying(): boolean { return this.airborne; }

 /** Circle contact with another car: separate, cancel approach along the normal, scrub speed. */
 /**
  * Contact with another car. `radius` is kept for callers that still think in circles; the body is
  * a capsule built from the car's own wheelbase and track.
  */
 bump(other: Car, radius: number): void {
  const a = this.body(radius), b = other.body(radius);
  const hit = contact(a, b);
  if (!hit) return;
  const response = respond(a, b, hit);
  this.arcade.x -= hit.nx * response.separation; this.arcade.z -= hit.nz * response.separation;
  other.arcade.x += hit.nx * response.separation; other.arcade.z += hit.nz * response.separation;
  this.shove(response.ax, response.az);
  other.shove(response.bx, response.bz);
  this.publish(); other.publish();
 }

 /** The car as a capsule: the wheelbase with an overhang at each end, the track with mirrors. */
 private body(radius: number): Body {
  const car = this.arcade;
  return {
   x: car.x, z: car.z, yaw: car.yaw, vx: car.vx, vz: car.vz,
   mass: this.profile.mass,
   halfLength: Math.max(radius, this.profile.wheelbase / 2 + OVERHANG),
   halfWidth: this.profile.trackWidth / 2 + MIRRORS,
  };
 }

 /**
  * Adds a world-space velocity change. It has to go into the car's own forward and lateral speeds,
  * not only into vx/vz: the tick rebuilds vx/vz from those two every frame, so a sideways shove
  * written to vx alone is thrown away before anything can act on it.
  */
 private shove(dx: number, dz: number): void {
  const car = this.arcade;
  this.impactLevel = Math.max(this.impactLevel, Math.hypot(dx, dz));
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  car.vFwd += dx * fx + dz * fz;
  car.vLat += dx * -fz + dz * fx;
  car.vx += dx;
  car.vz += dz;
 }

 private publish(): void {
  const car = this.arcade, s = this.state;
  s.x = car.x; s.z = car.z; s.yaw = car.yaw;
  s.y = this.height;
  const n = this.normal(car.x, car.z), cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  // ground normal in the body frame (yaw 0 faces -Z, +X right)
  const nx = cy * n.x - sy * n.z, nz = sy * n.x + cy * n.z;
  // In the air there is no ground normal to sit on: the body holds its flight path and levels out.
  s.pitch = this.airborne ? this.airPitch : Math.atan2(nz, n.y);
  s.roll = this.airborne ? s.roll * (1 - AIR_PITCH_RATE) : -Math.atan2(nx, n.y);
  s.speed = car.vFwd * 3.6;
  s.rpm = Math.max(IDLE_RPM, Math.abs(car.rpm));
  s.gear = car.gear === 0 ? -1 : car.gear === 1 ? 0 : car.gear - 1;
  s.steerAngle = this.steerAngle(car);
  const as = Math.abs(car.skid);
  s.slipFront = car.lock ? 1 : as === 3 || as === 5 ? 0.6 : 0;
  s.slipRear = as >= 1 && as <= 4 ? 1 : 0;
  s.distance = this.projectOnLoop(car.x, car.z);
  s.impact = this.impactLevel;
 }

 private projectOnLoop(x: number, z: number): number {
  if (this.loop.length < 2) return 0;
  let best = Infinity, dist = 0;
  for (let i = 1; i < this.loop.length; i++) {
   const ax = this.loop[i - 1][0], az = this.loop[i - 1][1];
   const dx = this.loop[i][0] - ax, dz = this.loop[i][1] - az;
   const len2 = dx * dx + dz * dz;
   const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
   const px = ax + dx * t - x, pz = az + dz * t - z;
   const d = px * px + pz * pz;
   if (d < best) { best = d; dist = this.cum[i - 1] + t * Math.sqrt(len2); }
  }
  return dist;
 }
}
