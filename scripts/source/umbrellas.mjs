// The beach parasols of a source track, and where real 3D umbrellas stand instead of them.
//
// The original dresses the sand with parasols the same way it draws its trees: keyed sprite cards
// (canopy halves, the pole and the base) that fake an umbrella. Up close the flat fans read as
// broken geometry, so the whole family is replaced by `assets/scenery/umbrella.glb`. A parasol is
// made of several cards at once, so the stands are deduplicated on a coarse grid and every
// umbrella gets the same real-world height.

import { cardBaseCentre, cardSpan } from './roadside.mjs';

/**
 * Parasol-family texture ids (QFS texNumber) on Last Resort: `t65`-`t68` the canopy halves and
 * domes, `t63`/`t64` the base, `t69` the pole and `t70`/`t71` the low fan halves. Nothing else on
 * this track uses them (the other keyed art is palms, shrubs, fences and the forest wall).
 */
export const UMBRELLA_TEXTURES = new Set([63, 64, 65, 66, 67, 68, 69, 70, 71]);

/** Real-world height of a beach parasol, in metres. */
export const UMBRELLA_HEIGHT = 2.2;

/** True when a card's texture is part of a parasol. */
export function isUmbrellaCard(textureNumber) {
  return UMBRELLA_TEXTURES.has(textureNumber);
}

/**
 * One parasol placement in world metres: `[x, y, z, h]`, where `y` is the pole base on the ground
 * and `h` is `UMBRELLA_HEIGHT`. `groundAt(x, z, baseY)` returns the terrain height under the card's
 * base edge, choosing the ground surface when the mesh draws more than one (or null when no ground
 * is drawn there, which drops the stand). The cards of one parasol sit within a couple of metres of
 * each other, so the stands are deduplicated on a 2 m grid.
 */
export function umbrellaPlacements(cards, groundAt, height = UMBRELLA_HEIGHT) {
  const best = new Map();
  for (const card of cards) {
    const [x, z] = cardBaseCentre(card.quad);
    const [bottom] = cardSpan(card.quad);
    const ground = groundAt(x, z, bottom);
    if (ground === null || ground === undefined) continue;
    const key = `${Math.round(x / 2)},${Math.round(z / 2)}`;
    if (!best.has(key)) best.set(key, [x, ground, z, height]);
  }
  return [...best.values()].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}
