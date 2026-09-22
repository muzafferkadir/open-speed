// The beach huts of a source track, and where a real hut stands instead of them.
//
// The original dresses the sand with small huts the same way it draws its trees: flat sprite cards
// (a pyramidal thatch roof, two wall panels and a ceiling) that fake a hut. In the source the walls
// start several metres above the beach, so with the cards drawn flat the roof reads as a slab
// floating on a pole -- the "roof on a stick" the reviewer flagged. The whole family is replaced by
// `assets/scenery/hut.glb`; a hut is a group of cards within a few metres of each other, so the
// stands are clustered on a coarse grid and each cluster gets one real hut on the ground.

import { cardBaseCentre, cardSpan } from './roadside.mjs';

/**
 * Hut-family texture ids (QFS texNumber) on Last Resort: `t394` the pyramidal roof, `t60`/`t61` the
 * wall panels, `t62` the ceiling and `t59` the wall with an opening. Nothing else on this track uses
 * them (the other keyed art is palms, shrubs, parasols, fences and the forest wall).
 */
export const HUT_TEXTURES = new Set([59, 60, 61, 62, 394]);

/** Real-world height of a beach hut, in metres. */
export const HUT_HEIGHT = 3;

/** True when a card's texture is part of a beach hut. */
export function isHutCard(textureNumber) {
  return HUT_TEXTURES.has(textureNumber);
}

/**
 * One hut placement in world metres: `[x, y, z, h]`, where `y` is the hut base on the ground and
 * `h` is `HUT_HEIGHT`. A hut is several cards; they are grouped on a `cell`-metre grid (each cluster
 * is one hut), anchored to the terrain under the cluster, and every hut gets the same real-world
 * height because the source cards carry no usable scale. `groundAt(x, z, baseY)` returns the terrain
 * height under a point, choosing the ground surface when the mesh draws more than one (or null when
 * no ground is drawn there, which drops the stand).
 */
export function hutPlacements(cards, groundAt, { cell = 4, height = HUT_HEIGHT } = {}) {
  const cells = new Map();
  for (const card of cards) {
    const [x, z] = cardBaseCentre(card.quad);
    const key = `${Math.round(x / cell)},${Math.round(z / cell)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ x, z, bottom: cardSpan(card.quad)[0] });
  }
  // Merge neighbouring cells: one hut's cards can straddle a cell boundary.
  const seen = new Set(), clusters = [];
  for (const key of cells.keys()) {
    if (seen.has(key)) continue;
    seen.add(key);
    const stack = [key], cluster = [];
    while (stack.length) {
      const [gx, gz] = stack.pop().split(',').map(Number);
      cluster.push(...cells.get(`${gx},${gz}`));
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const next = `${gx + dx},${gz + dz}`;
        if (cells.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    clusters.push(cluster);
  }
  const placements = [];
  for (const cluster of clusters) {
    const n = cluster.length;
    const x = cluster.reduce((s, c) => s + c.x, 0) / n;
    const z = cluster.reduce((s, c) => s + c.z, 0) / n;
    const base = Math.min(...cluster.map(c => c.bottom));
    const ground = groundAt(x, z, base);
    if (ground === null || ground === undefined) continue;
    placements.push([+x.toFixed(3), ground, +z.toFixed(3), height]);
  }
  return placements.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}
