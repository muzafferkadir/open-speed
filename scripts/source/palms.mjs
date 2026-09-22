// The cut-out palms of a source track, and where real 3D palms stand instead of them.
//
// A palm card is told apart from a forest-wall card the only way the source allows: by its texture.
// The palms are the keyed trunk-and-fronds sprites — the art `p<id>.dat` fills as `spriteIndex`
// entries — and the dense vegetation walls are a separate, lower foliage set that keeps its place.
//
// The ground anchor is the subtle part. The source does not store a root position for a sprite: it
// stores a *textured plane* offset down from the object's base, so the card's own bottom edge sits
// above the terrain on any slope and cannot be trusted. What it shares instead is the art's frame:
// every palm family ends at the last row of a 128-row texture sheet, so the sheet row, not the world
// Y, is the quantity that is the same for all of them. The anchor row is read from the cards, and
// each card is then dropped from *its own* bottom edge by its own remaining height — which is self
// calibrating and reproduces exactly what the source did per card: bottom edge minus base offset.

import { cardCentre, cardSpan, dedupeStands } from './roadside.mjs';

/**
 * Palm-family texture ids (QFS texNumber) on Last Resort: `t192`/`t193` the tall lone roadside
 * palms, `t194`/`t195` the wide low palm, `t424`/`t425` the palmetto pair and `t426`/`t427` its dark
 * copy — each pair a lit and a dark variant. Nothing else in the track's 428 textures is a palm:
 * the remaining foliage (t176/t188-t191/t307/t359) is the forest-wall set.
 */
export const PALM_TEXTURES = new Set([192, 193, 194, 195, 424, 425, 426, 427]);

/** Sheet rows, the palm art's own vertical measure: all palm families end at the last row. */
export const SHEET_ROWS = 128;

/** The sheet row where the palm art ends, as the median of the cards' own bottom edges. */
export function anchorRow(cards) {
  const rows = cards.map(c => c.row).filter(r => Number.isFinite(r)).sort((a, b) => a - b);
  return rows.length ? rows[rows.length >> 1] : null;
}

/** True when a card's texture is a palm sprite. */
export function isPalmCard(textureNumber) {
  return PALM_TEXTURES.has(textureNumber);
}

/**
 * One palm placement in world metres: `[x, y, z, h]`, where `y` is the trunk base and `h` is the
 * art height. `h` is what a height-1 scenery model is scaled by, so a palm keeps the source's scale.
 */
export function palmPlacements(cards) {
  const row = anchorRow(cards);
  if (row === null) return [];
  const placements = [];
  for (const card of cards) {
    const [x, z] = cardCentre(card.quad);
    // The card's own bottom edge, corrected by the art row that has to land on the ground.
    const [bottom, top] = cardSpan(card.quad);
    const y = bottom - (SHEET_ROWS - card.row) / SHEET_ROWS * (top - bottom);
    placements.push([x, y, z, top - y]);
  }
  return dedupeStands(placements);
}
