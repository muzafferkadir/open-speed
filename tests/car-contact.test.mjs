import assert from 'node:assert/strict';
import { test } from 'node:test';
import vehicles from '../src/data/vehicles.json' with { type: 'json' };
import { Car } from '../src/physics/Car.ts';

/** A featureless flat plain: the contact tests care about cars, not about the world. */
const plain = {
 heightAt: () => 0,
 surfaceAt: () => 'road',
 hit: () => null,
 circuit: [[0, 0], [0, -1000], [0, -2000]],
};

const profile = () => ({ ...vehicles[0].physics, ...vehicles[0].dimensions });

/** A car at (x, z) facing -Z, rolling forward at `speed` metres a second. */
const rolling = (x, z, speed) => {
 const car = new Car(profile(), plain);
 car.reset(x, z, 0);
 car.arcade.vFwd = speed;
 car.arcade.vx = 0;
 car.arcade.vz = -speed;
 return car;
};

test('a shunt from behind speeds the car in front up, not down', () => {
 // The complaint this fixes: being rear-ended used to slow you down, because the response took a
 // flat percentage off both cars whoever hit whom.
 const front = rolling(0, -3.5, 30), behind = rolling(0, 0, 45);
 behind.bump(front, 1.4);
 assert.ok(front.arcade.vFwd > 30, `the car in front should be shoved along: 30 -> ${front.arcade.vFwd}`);
 assert.ok(behind.arcade.vFwd < 45, `the car behind pays for it: 45 -> ${behind.arcade.vFwd}`);
});

test('the shove reaches the car\'s own forward speed, not just its world velocity', () => {
 // vFwd and vLat are what the tick integrates; vx/vz are rebuilt from them every frame, so an
 // impulse written only to vx/vz is thrown away before it can do anything.
 const front = rolling(0, -3.5, 20), behind = rolling(0, 0, 40);
 behind.bump(front, 1.4);
 assert.ok(front.state.speed > 20 * 3.6, 'the published speed follows the shove');
});

test('a side-swipe moves the car sideways', () => {
 const mine = rolling(0, 0, 40), theirs = rolling(1.5, 0, 40);
 theirs.arcade.vx = -5;
 mine.bump(theirs, 1.4);
 assert.ok(mine.arcade.vLat !== 0, 'a sideways hit has to end up in the lateral speed');
 assert.ok(mine.arcade.vFwd > 35, `a glancing hit must not scrub the speed off: ${mine.arcade.vFwd}`);
});

test('cars that are not touching are left alone', () => {
 const a = rolling(0, 0, 40), b = rolling(0, -30, 20);
 a.bump(b, 1.4);
 assert.equal(a.arcade.vFwd, 40);
 assert.equal(b.arcade.vFwd, 20);
});

test('a knock is remembered for a moment and then fades', () => {
 // What the AI reads: without it an opponent steers a hit out in the same frame and contact
 // means nothing to it.
 const front = rolling(0, -3.5, 20), behind = rolling(0, 0, 45);
 behind.bump(front, 1.4);
 assert.ok(front.state.impact > 1, `a shunt should register: ${front.state.impact}`);
 const hit = front.state.impact;
 for (let i = 0; i < 32; i++) front.step({ throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: false }, 1 / 64);
 assert.ok(front.state.impact < hit * 0.2, 'and fade within about half a second');
});

test('a light touch is not a knock', () => {
 const front = rolling(0, -3.5, 30), behind = rolling(0, 0, 31);
 behind.bump(front, 1.4);
 assert.ok(front.state.impact < 1, `a 1 m/s closing speed is a nudge: ${front.state.impact}`);
});
