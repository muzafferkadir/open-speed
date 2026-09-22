// Depth cueing from the `LGT` descriptor (scripts/source/lgt.mjs).
//
// The engine's depth cue is a list of (distance m, light) pairs: geometry is shaded by the light
// level at its distance. `TR04.LGT` gives `0/15, 100/15, 200/13, 250/10` -- full light out to
// 100 m, then dimming to 10/15 of it by 250 m. All eight tracks ship the same file, so these are
// the shared engine numbers, not per-track art.
//
// Measured from the file: the distances and light levels above, and that the ramp is monotonic.
// Inferred (documented as such): the light level maps to a blend toward the horizon colour, which
// is how the source reads on screen. `depthCueFog` is the single place that mapping happens.

import type { RoadLight } from '../physics/RoadWorld';

/** Light level 15 is the descriptor's maximum (0..15), so it is the "no fade" end of the ramp. */
export const MAX_LIGHT = 15;

/**
 * Blend factor toward the haze at a distance, 0 = untouched geometry, 1 = fully hazed.
 * `0/15` and `100/15` give 0; `250/10` gives `1 - 10/15` = 1/3 at the far end of the cue.
 */
export function hazeAt(light: RoadLight | null | undefined, metres: number): number {
  const cue = light?.depthCue;
  if (!cue?.length) return 0;
  if (metres <= cue[0][0]) return 1 - cue[0][1] / MAX_LIGHT;
  for (let i = 1; i < cue.length; i++) {
    const [d0, l0] = cue[i - 1];
    const [d1, l1] = cue[i];
    if (metres <= d1) {
      const t = d1 === d0 ? 0 : (metres - d0) / (d1 - d0);
      return 1 - (l0 + (l1 - l0) * t) / MAX_LIGHT;
    }
  }
  return 1 - cue[cue.length - 1][1] / MAX_LIGHT;
}

/**
 * Fog distances for the descriptor: `near` is the last distance still at full light and `far` the
 * last cue point, so `TR04.LGT` reads 100 m -> 250 m. `far` here is the light cue's own end and is
 * what `createFog` scales the haze to.
 */
export function fogRange(light: RoadLight | null | undefined): [number, number] {
  const cue = light?.depthCue;
  if (!cue?.length) return [100, 250];
  const full = cue[0][1];
  let near = cue[0][0];
  for (const [d, l] of cue) if (l >= full) near = d;
  return [near, cue[cue.length - 1][0]];
}

/**
 * Exponential density that blends `amount` of the way to the fog colour by `far` metres. The
 * density is driven by the descriptor's own depth-cue end (900 m for TR04, `0/450/600/900`): 100 m
 * out the road still reads (~13 % haze) while a 300 m palm has faded a third of the way into the
 * horizon and a 450 m headland is half gone, which is the depth cue the far cue point describes.
 */
export const expDensity = (far: number, amount: number) =>
  -Math.log(1 - Math.min(amount, 0.99)) / Math.max(far, 1e-6);

/** Proportion of the haze applied at the depth cue's far distance (900 m for TR04). */
export const FOG_DEPTH = 0.78;
