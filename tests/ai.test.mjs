import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiDriver, apexOffset, approachSpeed, catchUp, cornerSpeed, insideWalls } from '../src/physics/AiDriver.ts';

/** A straight road that turns into a corner of `curve` (1/1024 turn per 300 m) past `bend` metres. */
const road = (bend, curve) => ({
 length: 4000,
 heightAt: () => 0,
 surfaceAt: () => 'road',
 hit: () => null,
 circuit: [[0, 0], [0, -2000]],
 // The world is a straight line down -Z; s is the distance along it.
 surfacePoint: (s, lateral) => ({ x: lateral, y: 0, z: -s, yaw: 0 }),
 locate: (x, z) => ({ s: -z, lateral: x, tx: 0, tz: -1 }),
 curveAhead: (_x, z) => (-z >= bend ? curve : 0),
});

test('a straight has no corner limit', () => {
 assert.equal(cornerSpeed(road(1e9, 0), 0), Infinity);
 assert.equal(approachSpeed(road(1e9, 0), 0), Infinity);
});

test('a tighter corner is a slower corner', () => {
 assert.ok(cornerSpeed(road(0, 120), 0) < cornerSpeed(road(0, 40), 0));
});

test('the driver slows for a corner it can see, not the one it is in', () => {
 // This is what stops an AI arriving at a hairpin flat out: by the time the limit applies where
 // it stands, it is too late to obey it.
 const world = road(200, 120);
 const atCorner = cornerSpeed(world, 200);
 const wayBack = approachSpeed(world, 0);
 const closeIn = approachSpeed(world, 180);
 assert.ok(closeIn < wayBack, `the limit has to tighten on approach: ${wayBack} -> ${closeIn}`);
 assert.ok(closeIn > atCorner, 'but it is still above the corner speed until the corner');
 assert.ok(wayBack > atCorner * 1.3, 'and far out it barely holds the car back');
});

test('the line moves to the inside of the corner', () => {
 assert.ok(apexOffset(road(0, 120), 0) > 0, 'a right-hander is taken from the right');
 assert.ok(apexOffset(road(0, -120), 0) < 0, 'and a left-hander from the left');
 assert.equal(apexOffset(road(1e9, 0), 0), 0, 'a straight has no apex to aim at');
});

test('a driver beached at a standstill eventually reverses out', () => {
 const driver = new AiDriver(road(1e9, 0), { lane: 0, look: 30, gain: 3 });
 const stopped = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, rpm: 800, rpmMax: 7000,
  gear: 1, steerAngle: 0, slipFront: 0, slipRear: 0, wheels: [], distance: 0, impact: 0 };
 let reversed = false;
 for (let i = 0; i < 200 && !reversed; i++) reversed = driver.drive(stopped, []).reverse === true;
 assert.ok(reversed, 'the driver has to notice it is going nowhere');
});

test('a driver at speed never reverses', () => {
 const driver = new AiDriver(road(1e9, 0), { lane: 0, look: 30, gain: 3 });
 const rolling = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 140, rpm: 5000, rpmMax: 7000,
  gear: 4, steerAngle: 0, slipFront: 0, slipRear: 0, wheels: [], distance: 0, impact: 0 };
 for (let i = 0; i < 400; i++) assert.equal(driver.drive(rolling, []).reverse, false);
});

test('a field beside the player races it, and one out of sight leans on its pace', () => {
 // Close enough to fight: nobody's pace is touched, so the position is settled by driving.
 assert.equal(catchUp(0), 1);
 assert.equal(catchUp(14), 1);
 assert.equal(catchUp(-14), 1);
 // The player pulling away: the field chases, harder the further it has to go, and stops there.
 assert.ok(catchUp(60) > 1);
 assert.ok(catchUp(140) > catchUp(60));
 assert.equal(catchUp(400), catchUp(140));
 // The player dropped: the field eases off, but never by as much as it will chase.
 assert.ok(catchUp(-60) < 1);
 assert.ok(catchUp(-140) < catchUp(-60));
 assert.equal(catchUp(-400), catchUp(-140));
 // Chasing leans much harder than waiting: a lead is built on the straights and only the chase
 // can buy it back there.
 assert.ok((catchUp(400) - 1) > 2 * (1 - catchUp(-400)));
 // Whatever the gap, the pace stays a pace: no opponent is teleported or parked.
 for (const gap of [-900, -200, -50, 0, 50, 200, 900]) {
  assert.ok(catchUp(gap) > 0.8 && catchUp(gap) < 1.6, `${gap} m -> ${catchUp(gap)}`);
 }
});

test('a lane the road has no room for is pulled back inside it', () => {
 const open = { left: 20, right: 20 };
 // Room to spare: the racing line is left alone.
 assert.equal(insideWalls(open, 5), 5);
 assert.equal(insideWalls(open, -5), -5);
 // A tunnel: the lane comes in far enough to leave the car room off the wall.
 const tunnel = { left: 5, right: 5 };
 assert.ok(5 - insideWalls(tunnel, 5) >= 1.5, `right: ${insideWalls(tunnel, 5)}`);
 assert.ok(insideWalls(tunnel, -5) + 5 >= 1.5, `left: ${insideWalls(tunnel, -5)}`);
 assert.ok(Math.abs(insideWalls(tunnel, 0)) < 1e-9);
 // Narrower than a car wants on both sides: take the middle rather than a wall.
 const slot = { left: 1.5, right: 1.5 };
 assert.ok(Math.abs(insideWalls(slot, 6)) < 0.01);
 // An off-centre corridor puts the middle where the room is.
 const shifted = { left: 1, right: 4 };
 assert.ok(insideWalls(shifted, 6) > 1);
});
