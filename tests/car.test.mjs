import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIDE_HEIGHT } from '../src/physics/Car.ts';
import { drive, flatWorld, input, newCar } from './helpers.mjs';

test('throttle accelerates the car', () => {
 assert.ok(drive(newCar(), input({ throttle: 1 }), 3).speed > 100);
});

test('state stays finite', () => {
 const state = drive(newCar(), input({ throttle: 1, steer: 1 }), 5);
 for (const [key, value] of Object.entries(state)) if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
});

test('brake stops the car without selecting reverse', () => {
 const car = newCar();
 drive(car, input({ throttle: 1 }), 5);
 const state = drive(car, input({ brake: 1 }), 8);
 assert.ok(Math.abs(state.speed) < 2);
 assert.ok(state.gear >= 0);
});

test('reverse engages only at a standstill', () => {
 const car = newCar();
 assert.equal(drive(car, input({ throttle: 1, reverse: true }), 3).gear, -1);
 drive(car, input({ throttle: 1 }), 5);
 assert.ok(drive(car, input({ throttle: 1, reverse: true }), 1).gear > 0);
});

test('positive steer turns right', () => {
 const car = newCar();
 drive(car, input({ throttle: 1 }), 2);
 const yaw = car.state.yaw;
 assert.ok(drive(car, input({ throttle: 1, steer: 1 }), 1).yaw < yaw - 0.2);
});

test('steering recentres', () => {
 const car = newCar();
 drive(car, input({ throttle: 1, steer: 1 }), 1);
 assert.equal(drive(car, input({ throttle: 1 }), 0.5).steerAngle, 0);
});

test('wall stops the car', () => {
 const hit = (x, z, r) => (z - r < -30 ? { nx: 0, nz: 1, depth: -30 - (z - r) } : null);
 const state = drive(newCar(flatWorld({ hit })), input({ throttle: 1 }), 4);
 assert.ok(state.z > -31.2);
});

test('body follows ground height', () => {
 const state = drive(newCar(flatWorld({ heightAt: () => 2 })), input(), 1);
 assert.ok(Math.abs(state.y - 2 - RIDE_HEIGHT) < 1e-9);
});

test('dirt is slower than road', () => {
 const road = drive(newCar(), input({ throttle: 1 }), 4).speed;
 const dirt = drive(newCar(flatWorld({ surfaceAt: () => 'ground' })), input({ throttle: 1 }), 4).speed;
 assert.ok(dirt < road * 0.9);
});

test('the front wheels show the arc the car is on, not the lock that was asked for', () => {
 const lock = 0.6;
 const fast = newCar();
 drive(fast, input({ throttle: 1 }), 8);
 const quick = drive(fast, input({ throttle: 0.4, steer: 1 }), 1);
 // Flat out, a car answers a fraction of full lock. Wheels drawn at the lock are on another car.
 assert.ok(Math.abs(quick.wheels[0].steer) < lock * 0.25,
  `${(quick.wheels[0].steer * 180 / Math.PI).toFixed(1)} deg at ${quick.speed.toFixed(0)} km/h`);
 // Whatever the angle, it points the way the car is turning.
 const before = quick.yaw;
 const later = drive(fast, input({ throttle: 0.4, steer: 1 }), 0.5);
 const turned = Math.atan2(Math.sin(later.yaw - before), Math.cos(later.yaw - before));
 assert.equal(Math.sign(later.wheels[0].steer), -Math.sign(turned));
 // Down to walking pace the same lock is most of the angle the car is actually on.
 const slow = newCar();
 const crawl = drive(slow, input({ throttle: 0.12, steer: 1 }), 4);
 assert.ok(Math.abs(crawl.speed) < 40, `${crawl.speed.toFixed(0)} km/h`);
 assert.ok(Math.abs(crawl.wheels[0].steer) > lock * 0.6,
  `${(crawl.wheels[0].steer * 180 / Math.PI).toFixed(1)} deg at ${crawl.speed.toFixed(0)} km/h`);
 // Only the front wheels steer.
 assert.equal(crawl.wheels[2].steer, 0);
 assert.equal(crawl.wheels[3].steer, 0);
});
