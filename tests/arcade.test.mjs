import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slopeGravity, TICK } from '../src/physics/Arcade.ts';

test('tick is 64 Hz', () => assert.equal(TICK, 1 / 64));

test('slope gravity branches', () => {
 assert.equal(slopeGravity(-8, -1, 1), -1);
 assert.equal(slopeGravity(-8, 1, 1), -0.25);
 assert.equal(slopeGravity(-8, 0, 1), 0);
 assert.equal(slopeGravity(-8, 0, 0), -1);
});
