import assert from 'node:assert/strict';
import { test } from 'node:test';
import vehicles from '../src/data/vehicles.json' with { type: 'json' };
import { Car, RIDE_HEIGHT, TICK } from '../src/physics/Car.ts';

const profile = () => ({ ...vehicles[0].physics, ...vehicles[0].dimensions });

/** A world whose height comes from one function of z; the car drives down -Z. */
const world = heightAt => ({
 heightAt: (_x, z) => heightAt(z),
 surfaceAt: () => 'road',
 hit: () => null,
 circuit: [[0, 0], [0, -1000], [0, -2000]],
});

/** A jump: flat, then a ramp climbing `rise` over `run` metres, then the ground drops away. */
const ramp = (start, run, rise) => z => {
 const along = -z - start;
 if (along <= 0 || along >= run) return 0;
 return (along / run) * rise;
};

/** A hill: the same climb, but the ground stays up there instead of falling away. */
const slope = (start, run, rise) => z => {
 const along = -z - start;
 if (along <= 0) return 0;
 return Math.min(1, along / run) * rise;
};

const drive = (car, seconds, input = { throttle: 1, brake: 0, steer: 0, handbrake: false, reverse: false }) => {
 const track = [];
 for (let i = 0; i < seconds / TICK; i++) {
  car.step(input, TICK);
  track.push({ z: car.state.z, y: car.state.y, flying: car.flying, pitch: car.state.pitch });
 }
 return track;
};

test('on flat ground the car stays on the ground', () => {
 const car = new Car(profile(), world(() => 0));
 car.reset(0, 0, 0);
 car.arcade.vFwd = 40;
 const track = drive(car, 2);
 assert.ok(!track.some(t => t.flying), 'nothing to launch off');
 for (const t of track) assert.ok(Math.abs(t.y - RIDE_HEIGHT) < 1e-6, `height drifted: ${t.y}`);
});

test('a ramp throws the car into the air and gravity brings it back', () => {
 // 40 m of flat, then a 25 m ramp climbing 5 m. At 40 m/s the crest is a real jump.
 const car = new Car(profile(), world(ramp(40, 25, 5)));
 car.reset(0, 0, 0);
 car.arcade.vFwd = 40;
 const track = drive(car, 7);
 const airborne = track.filter(t => t.flying);
 assert.ok(airborne.length > 12, `the car should leave the ramp: ${airborne.length} ticks in the air`);
 const peak = Math.max(...airborne.map(t => t.y));
 assert.ok(peak > 5 + RIDE_HEIGHT, `it should clear the crest: peak ${peak.toFixed(2)} m`);
 assert.ok(!track.at(-1).flying, 'and it has to come down');
 assert.ok(Math.abs(track.at(-1).y - RIDE_HEIGHT) < 0.01, `and land on the ground: ${track.at(-1).y}`);
});

test('the nose follows the flight path instead of a ground normal', () => {
 const car = new Car(profile(), world(ramp(40, 25, 5)));
 car.reset(0, 0, 0);
 car.arcade.vFwd = 40;
 const track = drive(car, 7);
 const airborne = track.filter(t => t.flying);
 const climbing = airborne.slice(0, 5), falling = airborne.slice(-5);
 assert.ok(climbing.some(t => t.pitch !== 0), 'the body pitches in the air');
 assert.ok(falling.at(-1).pitch < climbing[0].pitch, 'nose up leaving, nose down arriving');
});

test('a gentle slope is driven, not flown', () => {
 // The same 5 m rise spread over 200 m, and the ground stays up: the car follows it all the way.
 const car = new Car(profile(), world(slope(40, 200, 5)));
 car.reset(0, 0, 0);
 car.arcade.vFwd = 40;
 assert.ok(!drive(car, 7).some(t => t.flying), 'a shallow climb must not launch the car');
});

test('the wheels know they are off the ground', () => {
 const car = new Car(profile(), world(ramp(40, 25, 5)));
 car.reset(0, 0, 0);
 car.arcade.vFwd = 40;
 let sawAirborneWheels = false;
 for (let i = 0; i < 7 / TICK; i++) {
  car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false, reverse: false }, TICK);
  if (car.flying) sawAirborneWheels ||= car.state.wheels.every(w => !w.contact);
 }
 assert.ok(sawAirborneWheels, 'wheel contact has to drop while flying');
});
