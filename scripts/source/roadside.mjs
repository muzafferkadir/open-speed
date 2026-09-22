// Shared rules for the original's cut-out roadside scenery cards.
//
// Every replacement prop (a palm, a shrub) starts from the same primitive: a standing quad the
// source drew the sprite art on. Two quantities are needed to plant a real model there -- where the
// card stands in the ground plane, and how tall its art is -- and neither may be read off the
// card's own bottom edge, because the source offsets the textured plane down from the object's
// base. The functions here take the card geometry apart; each prop family then supplies its own
// ground anchor (palms use the shared sprite-sheet baseline, shrubs the terrain under the base).

/** Centre of a card in the ground plane, `[x, z]` (the card is thin in that plane). */
export function cardCentre(quad) {
  const n = quad.length;
  return [
    quad.reduce((sum, p) => sum + p[0], 0) / n,
    quad.reduce((sum, p) => sum + p[2], 0) / n,
  ];
}

/** Vertical extent of a card: `[bottom, top]`, the extremes of its corners in world Y. */
export function cardSpan(quad) {
  const ys = quad.map(p => p[1]);
  return [Math.min(...ys), Math.max(...ys)];
}

/**
 * Ground position of a card's base in the ground plane, `[x, z]`: the midpoint of its lowest
 * edge, not the centre of the whole quad. A card on a slope is tilted, so the quad's centre sits
 * up the hill from where the plant's trunk meets the ground; sampling the terrain there plants the
 * prop too high. For a standing rectangle the two lowest corners are the base edge; a triangular
 * card contributes its single lowest corner.
 */
export function cardBaseCentre(quad) {
  const bottom = cardSpan(quad)[0];
  const low = quad.filter(p => p[1] <= bottom + 1e-6);
  const n = low.length || 1;
  return [
    low.reduce((sum, p) => sum + p[0], 0) / n,
    low.reduce((sum, p) => sum + p[2], 0) / n,
  ];
}

/**
 * The bowtie front/back halves of one sprite share a ground position; keep the taller copy of each
 * so a plant is not planted twice, then order the stands deterministically (byte-identical
 * rebuilds). `placements` are `[x, y, z, h]`.
 */
/** Deterministic 0..1 hash of a quantised point and an integer salt; used for prop jitter. */
export function hash01(x, z, salt = 0) {
 let h = Math.imul(Math.round(x * 100) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
 h = Math.imul(h ^ (Math.round(z * 100) + salt), 0xc2b2ae35) >>> 0;
 return (h >>> 8) / 16777216;
}

export function dedupeStands(placements) {
  const best = new Map();
  const key = ([x, , z]) => `${Math.round(x)},${Math.round(z)}`;
  for (const stand of placements) {
    const id = key(stand), previous = best.get(id);
    if (!previous || previous[3] < stand[3]) best.set(id, stand);
  }
  return [...best.values()].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}
