import assert from 'node:assert/strict';
import { test } from 'node:test';
import last from '../assets/maps/last-resort.json' with { type: 'json' };
import { RoadWorld } from '../src/physics/RoadWorld.ts';

const world = () => new RoadWorld(last);

test('a measured wall closer than the corridor pulls the limit in', () => {
 // This is the escape: the corridor is the source's own drivable width, and where it is wider
 // than the rock a car drives through the rock and ends up outside the world.
 const road = world();
 const before = road.frames[10].right;
 const left = new Float32Array(road.frames.length).fill(-1);
 const right = new Float32Array(road.frames.length).fill(-1);
 right[10] = 8;
 road.applyMeasuredWalls(left, right);
 assert.ok(road.frames[10].right < before, `expected a tighter limit than ${before}`);
 assert.ok(road.frames[10].right < 8, 'and it must stop short of the rock, not at it');
});

test('a measured wall further out lets the corridor open up', () => {
 // And this is the invisible wall: the car catching on nothing metres from the rock.
 const road = world();
 const left = new Float32Array(road.frames.length).fill(-1);
 const right = new Float32Array(road.frames.length).fill(-1);
 left[20] = 30;
 road.applyMeasuredWalls(left, right);
 assert.ok(road.frames[20].left > 20, `expected room out to the rock: ${road.frames[20].left}`);
});

test('a frame with no wall keeps what the source said', () => {
 const road = world(), plain = world();
 const none = new Float32Array(road.frames.length).fill(-1);
 road.applyMeasuredWalls(none, none);
 for (let i = 0; i < road.frames.length; i += 97)
  assert.equal(road.frames[i].left, plain.frames[i].left, `frame ${i} was changed with nothing measured`);
});

test('the corridor never closes to nothing, however close the rock', () => {
 const road = world();
 const tight = new Float32Array(road.frames.length).fill(0.2);
 road.applyMeasuredWalls(tight, tight);
 for (let i = 0; i < road.frames.length; i += 97)
  assert.ok(road.frames[i].left >= 4, `frame ${i} closed to ${road.frames[i].left} m`);
});
