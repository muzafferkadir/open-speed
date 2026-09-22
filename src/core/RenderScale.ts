/**
 * Adaptive render resolution.
 *
 * The drive renders through a post-processing stack - bloom, a radial blur, a grade - and all of it
 * runs per pixel, so on a high-density display at ratio 2 it is four times the work of ratio 1.
 * A machine that cannot keep up does not degrade gracefully there; it stutters. This watches the
 * frame times and steps the ratio down until the frames fit the budget, then back up if the room
 * comes back, which is the difference between a softer picture and a jerky one.
 */

/** The ratios stepped through, coarsest first. */
export const SCALES = [1, 1.25, 1.5, 1.75, 2] as const;

/** Frames per window before a decision is made; about three quarters of a second. */
export const WINDOW = 45;
/** Median frame time (ms) above which the picture is scaled down: under ~50 fps. */
const SLOW_MS = 20;
/** Median frame time (ms) below which it is worth trying a sharper picture again. */
const FAST_MS = 13.5;
/**
 * Fast windows in a row before a ratio that already failed is offered again.
 *
 * Stepping back up the moment the frames fit is how the picture ends up oscillating between two
 * ratios: the sharper one is too slow, the coarser one is fast, so it climbs, stalls, drops, and
 * climbs again. Each of those moves reallocates every render target in the post stack, which costs
 * a frame on its own and keeps the cycle fed. A level that failed is written off until the machine
 * has been comfortably fast for a while.
 */
export const RECOVERY_WINDOWS = 6;

export class RenderScale {
 private readonly samples: number[] = [];
 private index: number;
 /** The highest ratio still on offer: a level that ran slow is written off until it is earned back. */
 private ceiling: number;
 /** The display's own ratio; the ceiling never climbs past it. */
 private readonly top: number;
 private fastWindows = 0;

 constructor(max: number) {
  let top = 0;
  for (let i = 0; i < SCALES.length; i++) if (SCALES[i] <= max) top = i;
  this.top = top;
  this.ceiling = top;
  this.index = top;
 }

 get value(): number { return SCALES[this.index]; }

 /**
  * Feeds one frame time. Returns the new ratio when it changed, or null while it stands - so the
  * caller only resizes on a real decision.
  */
 sample(ms: number): number | null {
  this.samples.push(ms);
  if (this.samples.length < WINDOW) return null;
  this.samples.sort((a, b) => a - b);
  const median = this.samples[this.samples.length >> 1];
  this.samples.length = 0;
  if (median > SLOW_MS) {
   this.fastWindows = 0;
   // Whatever was being drawn is too slow: write that level off, and drop if there is room.
   this.ceiling = Math.max(0, this.index - 1);
   return this.index > 0 ? SCALES[--this.index] : null;
  }
  if (median >= FAST_MS) { this.fastWindows = 0; return null; }
  this.fastWindows++;
  if (this.fastWindows < RECOVERY_WINDOWS) return null;
  this.fastWindows = 0;
  if (this.ceiling < this.top) this.ceiling++;
  return this.index < this.ceiling ? SCALES[++this.index] : null;
 }
}
