// The low foliage cut-outs of a source track, and where real shrubs stand instead of them.
//
// Alongside the palms the original dresses the verge with small keyed plant cards: a leafy clump
// that the source draws 3-5 m tall right at the road edge. They are the same kind of primitive as
// the palms (a standing quad carrying sprite art) but they are not a palm family, so they get their
// own list and their own ground anchor.
//
// The anchor cannot be the sprite-sheet baseline the palms share: a shrub card is drawn on whatever
// slope it happens to stand on, so its own bottom edge moves with the terrain (measured: the same
// family lands 0-20 m above the drawn ground). The place that is unambiguous is the ground itself,
// so a shrub is planted on the track mesh under the card's *base edge* -- the midpoint of its two
// lowest corners, not the quad centre, because a tilted card's centre sits up the hill from where
// the plant meets the ground. Where the mesh draws several surfaces over that point (a bank, a
// canopy, a floating structure) the ground is the near-horizontal one when there is one, else the
// surface nearest the card's own bottom edge; taking the topmost left the shrub hanging in the air.
// Its height is the card's art height, which keeps the source's scale.

import { cardBaseCentre, cardSpan, dedupeStands } from './roadside.mjs';

/**
 * Shrub texture ids (QFS texNumber) on Last Resort: `t232` the leafy bush, `t142`/`t414` and
 * `t143`/`t415` two lit/dark copies of the low clump (`t414` and `t415` are byte-identical to
 * `t142` and `t143`), and `t58` the low fern. Everything else keyed and short on this track is
 * architecture -- `t215`/`t216` the roadside railing, `t220`/`t229` fences, `t236`-`t243` crates
 * and planks -- and keeps its place, as does the tall forest wall (`t188`-`t191`/`t307`/`t359`).
 */
export const SHRUB_TEXTURES = new Set([58, 142, 143, 232, 414, 415]);

/** True when a card's texture is a low foliage sprite. */
export function isShrubCard(textureNumber) {
  return SHRUB_TEXTURES.has(textureNumber);
}

/**
 * One shrub placement in world metres: `[x, y, z, h]`, where `y` is the model base on the ground
 * and `h` is the card's art height. `groundAt(x, z, baseY)` returns the terrain height just under
 * a point, choosing the surface nearest the card's own bottom edge when the mesh draws more than
 * one (or null when no ground is drawn there, which drops the stand).
 */
export function shrubPlacements(cards, groundAt, minHeight = 2, maxHeight = 8) {
  const placements = [];
  for (const card of cards) {
    const [bottom, top] = cardSpan(card.quad);
    const height = top - bottom;
    if (height < minHeight || height > maxHeight) continue;
    const [x, z] = cardBaseCentre(card.quad);
    const ground = groundAt(x, z, bottom);
    if (ground === null || ground === undefined) continue;
    placements.push([x, ground, z, height]);
  }
  return dedupeStands(placements);
}
