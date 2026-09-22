// Racing AI on the arcade model: chases a look-ahead point on its own lane, full throttle up to
// its pace cap, nudges sideways around slower cars. Pure; one instance per opponent.

import type { CarInput, CarState, World } from './types';

/** `maxKmh` is the driver's pace: it lifts above it (the throttle is on/off, so a partial
 *  throttle would not slow the car). Omit for flat out. */
export type AiSkill = { lane: number; look: number; gain: number; maxKmh?: number };

/** Velocity change (m/s) that counts as a full-blown knock; below it the driver is only shaken. */
const HARD_KNOCK = 7;

/** How far ahead the driver reads the road for a corner, and how finely, in metres. */
const LOOK_AHEAD = 260, LOOK_STEP = 20;
/** Braking the driver counts on, m/s^2. Below what the car can do, so it arrives with a margin. */
const BRAKING = 8.5;
/** Metres of lane the driver gives up to the inside of a corner, and how fast the line moves. */
const APEX_PULL = 3.2, LANE_RATE = 0.035;
/** Room the driver leaves between itself and a wall, and the lane it falls back on where the
 *  world does not say how wide it is. */
const WALL_MARGIN = 2.0, OPEN_ROAD = 6;
/** Under this speed for this long, the driver is stuck and backs out. */
const STUCK_KMH = 6, STUCK_TICKS = 96, REVERSE_TICKS = 64;

/**
 * The speed a corner at `s` can be taken at, in km/h, from the heading change over the next 300 m.
 * The map data carries no cornering speeds, so the limit is worked out rather than read;
 * the banking adds grip, which is why it is in here.
 */
export function cornerSpeed(world: World, s: number): number {
 if (!world.surfacePoint || !world.curveAhead) return Infinity;
 const here = world.surfacePoint(s, 0);
 const curve = Math.abs(world.curveAhead(here.x, here.z));
 if (curve <= 4) return Infinity;
 const radius = 300 / ((curve * 2 * Math.PI) / 1024);
 const tilt = Math.abs(world.surfacePoint(s, 4).y - world.surfacePoint(s, -4).y) / 8;
 return 3.6 * Math.sqrt(9.81 * (1 + 1.6 * tilt) * radius) * 0.94;
}

/**
 * The fastest the driver may be going now to still make every corner it can see.
 *
 * Reading only the corner it is standing in is what makes an AI arrive at a hairpin flat out and
 * then understeer into the wall: by the time the limit applies it is too late to obey it. For a
 * corner `d` metres away the arithmetic is v^2 = u^2 + 2 a d, so a limit far off allows a much
 * higher speed now and one that is close allows almost none.
 */
export function approachSpeed(world: World, s: number): number {
 let cap = Infinity;
 for (let d = 0; d <= LOOK_AHEAD; d += LOOK_STEP) {
  const limit = cornerSpeed(world, s + d);
  if (!Number.isFinite(limit)) continue;
  const metres = limit / 3.6;
  cap = Math.min(cap, 3.6 * Math.sqrt(metres * metres + 2 * BRAKING * d));
 }
 return cap;
}

/**
 * Which way the road bends over the next stretch, as a signed lane offset: positive is right.
 * The driver gives up lane to the inside of the corner, which is the difference between following
 * a painted line round a track and driving it.
 */
/**
 * The lane, pulled inside whatever the road leaves room for.
 *
 * A driver picks its lane off the racing line and the car in front of it, and neither of those
 * knows that the road is about to become a tunnel. Where the corridor closes in, the lane has to
 * come with it - a metre of wall is worth more than a metre of apex, and a car wedged against one
 * has lost the race rather than a corner.
 */
export function insideWalls(room: { left: number; right: number }, lane: number): number {
 const left = -room.left + WALL_MARGIN, right = room.right - WALL_MARGIN;
 // A corridor narrower than the room a car wants on both sides: take the middle of what there is.
 if (left > right) return (room.right - room.left) / 2;
 return Math.max(left, Math.min(right, lane));
}

export function apexOffset(world: World, s: number): number {
 if (!world.surfacePoint || !world.curveAhead) return 0;
 const here = world.surfacePoint(s, 0);
 const curve = world.curveAhead(here.x, here.z);
 if (Math.abs(curve) <= 4) return 0;
 // curveAhead is positive to the right, and the inside of a right-hander is to the right.
 return Math.sign(curve) * Math.min(APEX_PULL, Math.abs(curve) / 40);
}
/** How much of the steering a full knock takes away, and above what share of one the driver lifts. */
const KNOCK_STEER = 0.55, KNOCK_LIFT = 0.4;

/** Metres of gap the field ignores, and the gap at which it is leaning as hard as it will. */
const DEAD_GAP = 15, FULL_GAP = 90;
/** The most an opponent will add to its pace to chase, and the most it will give away to wait. */
const CHASE = 0.45, EASE = 0.12;

/**
 * What a driver does with its pace when the player is not beside it, as a multiplier on the cap.
 *
 * A field that drives the same lap whatever the player does is a field you either never see again
 * or never get away from, and both are the same race. `ahead` is how far in front the player is,
 * in metres of track: in front and the opponents lean on it, behind and they ease off enough that
 * the gap can be closed by driving well. Inside `DEAD_GAP` nothing changes, so a fight for a
 * position is settled by the two cars in it rather than by a hand on the scale.
 *
 * Chasing is worth far more than waiting. A pace cap is a cap on the straights and nothing else -
 * in the corners the driver is already held by what it can see - so a few per cent of it buys back
 * very little of a lead built on a long one. Past `FULL_GAP` the cap is asking for more than any
 * of these cars has, which is the point: the whole field is flat out and the race is still on.
 */
export function catchUp(ahead: number): number {
 const past = Math.abs(ahead) - DEAD_GAP;
 if (past <= 0) return 1;
 const lean = Math.min(1, past / (FULL_GAP - DEAD_GAP));
 return 1 + lean * (ahead > 0 ? CHASE : -EASE);
}

export class AiDriver {
 /** Multiplier on the pace cap, set by the race from how the player is doing. */
 pace = 1;
 private lane: number;
 private stalled = 0;
 private backing = 0;
 private readonly world: World;
 readonly skill: AiSkill;
 constructor(world: World, skill: AiSkill) { this.world = world; this.skill = skill; this.lane = skill.lane; }

 drive(me: CarState, others: CarState[]): CarInput {
  const world = this.world;
  if (!world.locate || !world.surfacePoint || !world.length) return { throttle: 1, brake: 0, steer: 0, handbrake: false, reverse: false };
  const at = world.locate(me.x, me.z);
  const speed = Math.abs(me.speed) / 3.6;
  // Slide the lane away from a car sitting in it up to 40 m ahead.
  let target = this.skill.lane;
  for (const o of others) {
   const p = world.locate(o.x, o.z);
   const gap = ((p.s - at.s) % world.length + world.length) % world.length;
   if (gap > 4 && gap < 40 && Math.abs(p.lateral - this.lane) < 3.5) target = p.lateral > 0 ? Math.min(this.lane, p.lateral - 4) : Math.max(this.lane, p.lateral + 4);
  }
  // The racing line: bias the lane toward the inside of whatever is coming.
  target += apexOffset(world, at.s);
  // Against the narrowest the road gets between here and where the driver is already looking, so
  // it is lined up for a tunnel before it reaches one rather than steering into the mouth of it.
  let room = { left: OPEN_ROAD, right: OPEN_ROAD };
  if (world.corridor) {
   const reach = this.skill.look + speed * 0.6;
   room = { left: Infinity, right: Infinity };
   for (let d = 0; d <= reach; d += 20) {
    const here = world.corridor(at.s + d);
    room = { left: Math.min(room.left, here.left), right: Math.min(room.right, here.right) };
   }
  }
  this.lane += (insideWalls(room, Math.max(-OPEN_ROAD, Math.min(OPEN_ROAD, target))) - this.lane) * LANE_RATE;
  const ahead = world.surfacePoint(at.s + this.skill.look + speed * 0.6, this.lane);
  let err = Math.atan2(-(ahead.x - me.x), -(ahead.z - me.z)) - me.yaw;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  // A knock unsettles the driver for a moment instead of being steered out in the same frame:
  // without this the opponents drive through contact as if it had not happened.
  const rattled = Math.min(1, (me.impact ?? 0) / HARD_KNOCK);
  const gain = this.skill.gain * (1 - KNOCK_STEER * rattled);
  const steer = Math.max(-1, Math.min(1, -err * gain + (at.lateral - this.lane) * 0.02));
  // Corner limit from the heading change 300 m ahead: v = sqrt(a·R), with the bank adding grip.
  // Approximate: the map carries no cornering speeds, and without this a hairpin is a wall.
  // Slow for the corner that is coming, not the one already being taken.
  const corner = approachSpeed(world, at.s);
  const cap = Math.min((this.skill.maxKmh ?? Infinity) * this.pace, corner), kmh = Math.abs(me.speed);
  // Running wide: drifting up the banking (toward the high, outer side) off the lane means too
  // much speed for the corner. Lift early, brake if it keeps growing, so the car settles back
  // before the wall does it. Sliding down toward the inside is harmless and just gets steered.
  const high = Math.sign(world.surfacePoint(at.s, 4).y - world.surfacePoint(at.s, -4).y);
  const off = high ? (at.lateral - this.lane) * high : 0;
  const wide = off > 1.2 && kmh > 80, veryWide = off > 2.8 && kmh > 120;
  const shaken = rattled > KNOCK_LIFT;
  // Beached against something: back out rather than sit there with the throttle pinned.
  if (kmh < STUCK_KMH) this.stalled++; else this.stalled = 0;
  if (this.stalled > STUCK_TICKS) {
   this.backing = REVERSE_TICKS;
   this.stalled = 0;
  }
  if (this.backing > 0) {
   this.backing--;
   return { throttle: 1, brake: 0, steer: -steer, handbrake: false, reverse: true };
  }
  return { throttle: kmh > cap || wide || shaken ? 0 : 1, brake: kmh > cap * 1.06 || veryWide ? 1 : 0, steer, handbrake: false, reverse: false };
 }
}
