// Opponents on the same arcade driving model, grid start, laps and standings. Rendering via VehicleView.

import * as THREE from 'three';
import vehicles from '../data/vehicles.json';
import { Car, RIDE_HEIGHT } from '../physics/Car.js';
import { AiDriver, catchUp } from '../physics/AiDriver.js';
import { cloneCarState, copyCarState, type CarState, type World } from '../physics/types.js';
import { HOLD, skyBlocked, wantsLight } from './headlights.js';
import type { Occluders } from './occlusion.js';
import { VehicleView } from './VehicleView.js';
import type { VehicleDesign } from './types.js';

/** Opponents: arcade physics profile, livery, and a pace cap (km/h) well under the player's 386 so
 *  the straights are where you make up for corners. Fastest first: they start at the front. */
const ROSTER: { arcade: string; tint: string; name: string; maxKmh: number }[] = [
 { arcade: 'falc', tint: '#d8d8dc', name: 'Falcon GT90', maxKmh: 320 },
 { arcade: 'dayl', tint: '#d0191c', name: 'Dayline 365', maxKmh: 305 },
 { arcade: 'pant', tint: '#1e5a3a', name: 'Panthera 220', maxKmh: 295 },
 { arcade: 'lumn', tint: '#f2c400', name: 'Lumen GT1', maxKmh: 285 },
 { arcade: 'nazr', tint: '#1b3d8f', name: 'Nazar C2', maxKmh: 275 },
];
const CAR_RADIUS = 1.4;
const ROW_GAP = 12;
const LANE = 3;

type Entry = {
 car: Car; state: CarState; previous: CarState; laps: number; prevS: number; finished: number;
 view?: VehicleView; ai?: AiDriver; name: string; tint: string;
 /** What the driver is doing with the pedals right now, so the lamps can show it. */
 braking: boolean; reversing: boolean;
 /** Headlights, on the same rule as the player's: lit, and the agreeing checks behind it. */
 lit: boolean; hold: number;
};

export type Standing = { position: number; name: string; you: boolean; tint: string; finished: number; laps: number };

export class Race {
 readonly group = new THREE.Group();
 private readonly entries: Entry[] = [];
 /** Scratch lists refilled each step, so the physics tick allocates nothing. */
 private readonly states: CarState[] = [];
 private readonly others_: CarState[] = [];
 private readonly player: Entry;
 private readonly world: World;
 readonly laps: number;
 private time = 0;
 /** Which opponent's sky is read next; the field takes turns. */
 private lightTurn = 0;
 /**
  * Settles once every opponent's model is in the scene.
  *
  * Their meshes bring materials of their own, and a material's shader is compiled the first time it
  * is drawn. Left to arrive on their own the five of them landed one after another over the opening
  * seconds, each stalling a frame in the middle of the start sweep. The caller waits on this while
  * the loading screen is still up.
  */
 readonly ready: Promise<void>;

 constructor(world: World, player: Car, laps: number, opponents: number) {
  this.world = world;
  this.laps = laps;
  const base = (vehicles as VehicleDesign[]).find(v => v.id === 'marlin-f1')!;
  const loading: Promise<unknown>[] = [];
  this.player = { car: player, state: player.state, previous: player.state, laps: -1, prevS: 0, finished: 0, name: 'You', tint: '#f9b64b', braking: false, reversing: false, lit: false, hold: 0 };
  this.entries.push(this.player);
  for (let i = 0; i < opponents && i < ROSTER.length; i++) {
   const r = ROSTER[i];
   const car = new Car({ ...base.physics, ...base.dimensions, arcade: r.arcade }, world);
   const view = new VehicleView();
   // The whole field is the same car; at racing distance it can be the light twin, which is what
   // lets the player's own car keep its detail.
   const model = base.model.lod ? { ...base.model, url: base.model.lod } : base.model;
   // Off until the road says otherwise, and said before the model arrives so its beams are built
   // dark: an opponent driving through daylight with its lamps on is what the old flag left behind.
   view.setHeadlights(false);
   loading.push(view.load({ ...base, model, visual: { ...base.visual, tint: r.tint } })
    .catch(error => console.warn('Opponent model failed to load', error)));
   this.group.add(view.group);
   this.entries.push({ car, state: cloneCarState(car.state), previous: cloneCarState(car.state), laps: -1, prevS: 0, finished: 0, view, ai: new AiDriver(world, { lane: i % 2 ? LANE : -LANE, look: 36 + i * 3, gain: 3, maxKmh: r.maxKmh }), name: r.name, tint: r.tint, braking: false, reversing: false, lit: false, hold: 0 });
  }
  this.ready = Promise.all(loading).then(() => undefined);
 }

 /** The drive screen builds a fresh player Car per run; keep the standings pointed at it. */
 setPlayer(car: Car): void { this.player.car = car; this.player.state = this.player.previous = car.state; }

 /** Grid: the player starts from the back row. */
 reset(): void {
  const n = this.entries.length;
  this.entries.forEach((e, i) => {
   const slot = i === 0 ? n - 1 : i - 1;
   const p = this.world.surfacePoint!(-ROW_GAP * slot - 6, slot % 2 ? LANE : -LANE);
   e.car.reset(p.x, p.z, p.yaw);
   // The grid sits behind the line: the first crossing starts lap 1.
   e.laps = -1; e.prevS = this.world.locate!(p.x, p.z).s; e.finished = 0;
   e.state = cloneCarState(e.car.state); e.previous = cloneCarState(e.car.state);
  });
  this.time = 0;
 }

 /** One physics tick for every opponent, then car-to-car contacts and lap counting. */
 step(dt: number): void {
  this.time += dt;
  // Both arrays are fields and are refilled in place: this runs 64 times a second and the two
  // fresh arrays per opponent it used to build were pure work for the collector.
  const states = this.states;
  states.length = 0;
  for (const entry of this.entries) states.push(entry.car.state);
  const others = this.others_;
  this.entries.forEach((e, i) => {
   if (!e.ai) return;
   others.length = 0;
   for (let j = 0; j < states.length; j++) if (j !== i) others.push(states[j]);
   const input = e.ai.drive(e.car.state, others);
   e.braking = input.brake > 0.5;
   e.reversing = !!input.reverse;
   e.car.step(input, dt);
   const spare = e.previous;
   e.previous = e.state;
   e.state = copyCarState(spare, e.car.state);
  });
  for (let i = 0; i < this.entries.length; i++) for (let j = i + 1; j < this.entries.length; j++) this.entries[i].car.bump(this.entries[j].car, CAR_RADIUS);
  const length = this.world.length ?? 0;
  for (const e of this.entries) {
   const s = this.world.locate!(e.car.state.x, e.car.state.z).s;
   if (e.prevS > length * .8 && s < length * .2) { e.laps++; if (this.laps && e.laps >= this.laps && !e.finished) e.finished = this.time; }
   else if (e.prevS < length * .2 && s > length * .8) e.laps--;
   e.prevS = s;
  }
  const player = this.travelled(this.player);
  for (const e of this.entries) if (e.ai) e.ai.pace = catchUp(player - this.travelled(e));
 }

 /** Metres of track covered, laps included; the measure the field paces itself against. */
 private travelled(entry: Entry): number { return entry.laps * (this.world.length ?? 0) + entry.prevS; }

 private sorted(): Entry[] {
  const length = this.world.length ?? 0;
  const progress = (e: Entry) => (e.finished ? 1e9 - e.finished : 0) + e.laps * length + e.prevS;
  return [...this.entries].sort((a, b) => progress(b) - progress(a));
 }

 /** Standings by laps then distance; the player's position is 1-based. */
 position(): number { return this.sorted().indexOf(this.player) + 1; }

 /** Full standings for the results board. */
 standings(): Standing[] {
  return this.sorted().map((e, i) => ({ position: i + 1, name: e.name, you: e === this.player, tint: e.tint, finished: e.finished, laps: Math.max(0, e.laps) }));
 }

 /** Opponent positions and liveries for the minimap. */
 others(): { x: number; z: number; color: string }[] {
  return this.entries.filter(e => e !== this.player).map(e => ({ x: e.car.state.x, z: e.car.state.z, color: e.tint }));
 }

 get allFinished(): boolean { return this.entries.every(e => e.finished > 0); }

 get playerLap(): number { return Math.max(1, Math.min(this.laps || Infinity, this.player.laps + 1)); }
 get playerFinished(): boolean { return this.player.finished > 0; }
 get count(): number { return this.entries.length; }

 /** Interpolated poses for the opponents, and the lamps that go with what they are doing. */
 render(alpha: number, held = false): void {
  for (const e of this.entries) {
   if (!e.view) continue;
   const a = e.previous, b = e.state;
   e.view.group.position.set(lerp(a.x, b.x, alpha), lerp(a.y, b.y, alpha) - RIDE_HEIGHT, lerp(a.z, b.z, alpha));
   e.view.group.rotation.y = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * alpha;
   e.view.applyPose(a, b, alpha);
   // On the grid every car sits on the brakes, which is what the player's own car shows.
   e.view.setLamps(held || e.braking, e.reversing);
  }
 }

 /**
  * Headlights for one opponent, on the player's rule: lit where the sky is shut out, with the same
  * two thresholds and the same agreeing checks behind the switch.
  *
  * One car per call rather than all of them: the probe is five rays, the caller already spaces its
  * own check out over frames, and a field of five taking turns is five times cheaper than the lot
  * of them every time - at the cost of a reaction that is five checks late, which no one can see.
  */
 updateHeadlights(occluders: Occluders): void {
  const opponents = this.entries.filter(e => e !== this.player && e.view);
  if (!opponents.length) return;
  const e = opponents[this.lightTurn++ % opponents.length];
  const on = wantsLight(skyBlocked(e.view!.group.position, occluders), e.lit);
  if (on === e.lit) { e.hold = 0; return; }
  if (++e.hold < HOLD) return;
  e.hold = 0;
  e.lit = on;
  e.view!.setHeadlights(on);
 }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
