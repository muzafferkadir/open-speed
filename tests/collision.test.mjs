import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contact, respond, RESTITUTION } from '../src/physics/collision.ts';

/** A car at (x, z) heading along -Z (yaw 0), moving at `vz` metres a second. */
const car = (x, z, vz = 0, vx = 0, yaw = 0, mass = 1200) => ({
 x, z, yaw, vx, vz, mass, halfLength: 2.2, halfWidth: 0.9,
});

/** Applies a response to two bodies, the way the physics does. */
const collide = (a, b) => {
 const hit = contact(a, b);
 if (!hit) return null;
 const r = respond(a, b, hit);
 a.vx += r.ax; a.vz += r.az;
 b.vx += r.bx; b.vz += r.bz;
 return { hit, ...r };
};

test('cars that are apart do not touch', () => {
 assert.equal(contact(car(0, 0), car(0, -10)), null);
 assert.equal(contact(car(0, 0), car(5, 0)), null);
});

test('a capsule knows nose to tail from side by side', () => {
 // Nose to tail: the normal runs along the cars' own axis.
 const inLine = contact(car(0, 0), car(0, -4));
 assert.ok(inLine, 'cars 4 m apart nose to tail overlap');
 assert.ok(Math.abs(inLine.nz) > 0.99, `expected a lengthways normal, got ${inLine.nx},${inLine.nz}`);
 // Side by side: the normal runs across them.
 const abreast = contact(car(0, 0), car(1.5, 0));
 assert.ok(abreast, 'cars 1.5 m apart abreast overlap');
 assert.ok(Math.abs(abreast.nx) > 0.99, `expected a sideways normal, got ${abreast.nx},${abreast.nz}`);
});

test('being shunted from behind pushes the car in front along', () => {
 // `behind` is chasing `front` down the -Z road and catches it.
 const front = car(0, -4, -20), behind = car(0, 0, -30);
 const speedBefore = -front.vz;
 collide(behind, front);
 assert.ok(-front.vz > speedBefore, `the car in front should be pushed on, went ${speedBefore} -> ${-front.vz}`);
 assert.ok(-behind.vz < 30, 'the car doing the shunting should lose the speed');
});

test('nothing is taken off the top: the pair keeps its momentum', () => {
 const front = car(0, -4, -20), behind = car(0, 0, -30);
 const before = front.mass * front.vz + behind.mass * behind.vz;
 collide(behind, front);
 const after = front.mass * front.vz + behind.mass * behind.vz;
 assert.ok(Math.abs(after - before) < 1e-6, `momentum ${before} -> ${after}`);
});

test('a head-on closing pair bounces apart', () => {
 const north = car(0, 0, -20), south = car(0, -4, 20);
 collide(north, south);
 assert.ok(north.vz > -20, 'the northbound car is slowed or thrown back');
 assert.ok(south.vz < 20, 'the southbound car is slowed or thrown back');
 // Restitution is arcade-small: this is a shunt, not a trampoline.
 assert.ok(Math.abs(north.vz) < 20 * (1 + RESTITUTION), 'nobody is launched');
});

test('a side-swipe pushes sideways and scrubs the slide, it does not stop the car', () => {
 // They are abreast; the other car drifts into mine while running a little slower, so there is
 // both a closing speed across the cars and a sliding speed along them.
 const mine = car(0, 0, -40), theirs = car(1.4, 0, -30, -4);
 collide(mine, theirs);
 assert.ok(mine.vx < -0.1, `the swiped car is pushed away sideways: ${mine.vx}`);
 assert.ok(theirs.vx > -4, 'the car doing the swiping is pushed back too');
 assert.ok(-mine.vz > 35, `a glancing hit must not scrub the speed off: ${-mine.vz}`);
 assert.ok(-mine.vz < 40, 'but it does rub a little speed off');
});

test('the heavier car shrugs the lighter one off', () => {
 const truck = car(0, 0, -30, 0, 0, 2400), kart = car(0, -4, -20, 0, 0, 600);
 const truckBefore = truck.vz, kartBefore = kart.vz;
 collide(truck, kart);
 assert.ok(Math.abs(kart.vz - kartBefore) > Math.abs(truck.vz - truckBefore) * 3,
  'the light car should take most of the change');
});

test('cars already moving apart are not impulsed again', () => {
 const a = car(0, 0, 5), b = car(0, -3, -5);
 const r = collide(a, b);
 assert.ok(r, 'they still overlap and are separated');
 assert.equal(r.ax, 0);
 assert.equal(r.az, 0);
 assert.ok(r.separation > 0);
});
