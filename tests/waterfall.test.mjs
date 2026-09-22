import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fallSpeed } from '../src/track/Waterfall.ts';

test('a taller fall runs faster', () => {
 assert.ok(fallSpeed(40) > fallSpeed(8), 'water picks up speed on the way down');
});

test('even a trickle scrolls', () => {
 assert.ok(fallSpeed(0) > 0, 'a zero height must not freeze the sheet');
 assert.ok(fallSpeed(-5) > 0, 'nor must a nonsense one');
});

test('the speed is capped, so a tall fall does not strobe', () => {
 // The sheet is a scrolling texture: past a point more speed is not more water, it is aliasing.
 assert.equal(fallSpeed(1000), fallSpeed(10000));
 assert.ok(fallSpeed(1000) <= 28);
});

test('the speed is a plausible metres a second, not a made-up number', () => {
 // Free fall from 20 m arrives at about 20 m/s; the sheet reads right at about half that.
 assert.ok(fallSpeed(20) > 8 && fallSpeed(20) < 13, `${fallSpeed(20)}`);
});
