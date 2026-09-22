import assert from 'node:assert/strict';
import { test } from 'node:test';
import track from '../assets/maps/proving-grounds.json' with { type: 'json' };
import { OvalWorld } from '../src/physics/OvalWorld.ts';

const world = new OvalWorld(track);

test('circuit follows the track points', () => {
 assert.equal(world.circuit.length, track.points.length);
 assert.equal(world.length, track.length);
});

test('centre line is road at track height', () => {
 const [x, y, z] = track.points[0];
 assert.equal(world.surfaceAt(x, z), 'road');
 assert.ok(Math.abs(world.heightAt(x, z) - y) < 0.5);
});

test('frame wraps around the loop', () => {
 assert.deepEqual(world.frame(world.length + 1), world.frame(1));
});
