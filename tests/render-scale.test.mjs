import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RenderScale, RECOVERY_WINDOWS, SCALES, WINDOW } from '../src/core/RenderScale.ts';

/** Feeds a whole window of frames at one speed and reports the ratio it settled on. */
const feed = (scale, ms, windows = 1) => {
 let last = null;
 for (let w = 0; w < windows; w++) for (let i = 0; i < WINDOW; i++) last = scale.sample(ms) ?? last;
 return last;
};

test('a display that cannot go past 1 stays there', () => {
 const scale = new RenderScale(1);
 assert.equal(scale.value, 1);
 assert.equal(feed(scale, 40), null, 'there is nothing below the coarsest ratio');
 assert.equal(scale.value, 1);
});

test('it starts at the display ratio and holds while frames fit', () => {
 const scale = new RenderScale(2);
 assert.equal(scale.value, 2);
 assert.equal(feed(scale, 16.7), null, 'a frame on budget is no reason to move');
 assert.equal(scale.value, 2);
});

test('slow frames step the picture down, one notch per window', () => {
 const scale = new RenderScale(2);
 assert.equal(feed(scale, 33), 1.75);
 assert.equal(feed(scale, 33), 1.5);
 assert.equal(feed(scale, 33), 1.25);
 assert.equal(feed(scale, 33), 1);
 assert.equal(feed(scale, 33), null, 'it cannot go below the coarsest ratio');
});

test('room that comes back is taken, but only after it has been earned', () => {
 const scale = new RenderScale(1.5);
 feed(scale, 33);
 assert.equal(scale.value, 1.25);
 assert.equal(feed(scale, 9, RECOVERY_WINDOWS - 1), null, 'one fast window is not enough to climb back');
 assert.equal(feed(scale, 9), 1.5);
 assert.equal(feed(scale, 9, RECOVERY_WINDOWS), null, 'the display ratio is the ceiling');
 assert.equal(scale.value, 1.5);
});

test('a ratio that ran slow is not offered again on the next fast window', () => {
 const scale = new RenderScale(2);
 assert.equal(feed(scale, 33), 1.75, 'the top ratio was too slow');
 // What a real machine does at the ratio below: comfortably fast. Climbing straight back would
 // put it at the ratio that just stalled, and the picture would flip between the two for ever.
 for (let w = 0; w < RECOVERY_WINDOWS - 1; w++) assert.equal(feed(scale, 9), null);
 assert.equal(scale.value, 1.75);
});

test('a decision needs a full window, not one bad frame', () => {
 const scale = new RenderScale(2);
 for (let i = 0; i < WINDOW - 1; i++) assert.equal(scale.sample(40), null);
 assert.equal(scale.sample(40), SCALES[SCALES.length - 2]);
});

test('the odd slow frame in a good window changes nothing', () => {
 const scale = new RenderScale(2);
 let moved = null;
 for (let i = 0; i < WINDOW; i++) moved = scale.sample(i === 3 ? 120 : 15) ?? moved;
 assert.equal(moved, null);
 assert.equal(scale.value, 2);
});
