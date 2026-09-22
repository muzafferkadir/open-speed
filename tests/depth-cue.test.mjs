import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fogRange, hazeAt } from '../src/game/DepthCue.ts';

const light = { depthCue: [[0, 15], [100, 15], [200, 13], [250, 10]] };

test('haze ramps from full light to the last cue', () => {
 assert.equal(hazeAt(light, 50), 0);
 assert.ok(Math.abs(hazeAt(light, 250) - 1 / 3) < 1e-9);
 assert.ok(Math.abs(hazeAt(light, 1000) - 1 / 3) < 1e-9);
 assert.ok(hazeAt(light, 150) > 0 && hazeAt(light, 150) < hazeAt(light, 225));
});

test('no cue means no haze', () => assert.equal(hazeAt({}, 500), 0));

test('fog range spans the dimming part', () => {
 assert.deepEqual(fogRange(light), [100, 250]);
 assert.deepEqual(fogRange({}), [100, 250]);
});
