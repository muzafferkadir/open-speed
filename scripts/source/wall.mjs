// The dense forest-wall backdrop cards of a source track.
//
// The wall is a run of tall foliage cards standing shoulder to shoulder along the verge. Drawn as
// plain quads with the same texture each, it reads as one copy stamped over and over: the card's own
// left and right edges do not meet, so every join is a hard vertical seam. This module carries the
// three fixes the extractor applies, all of them read off the source cards:
//
//   - mirror the texture on alternate cards, so two neighbours meet on matching edges instead of
//     repeating the same column of art (the mirror makes the tiling seamless by construction);
//   - darken each card's vertical edges with a per-vertex colour, so the remaining join reads as a
//     soft shaded fold rather than a cut (the colour is a vertex attribute, so the texture -- also
//     used by flat foliage terrain -- is untouched);
//   - break the ground line with a row of real shrubs at the wall's base, every few metres, jittered
//     so the run does not read as a comb.
//
// Which cards are wall cards is a property of the texture, measured on TR04 (t188-t191 are the lit
// and dark copies of the wall art, t307/t359 the two lower variants).

import { dedupeStands, hash01 } from './roadside.mjs';

/** Wall-family texture ids (QFS texNumber). */
export const WALL_TEXTURES = new Set([188, 189, 190, 191, 307, 359]);

/** Nominal width of one backdrop card in metres: the mirror alternation period. */
export const WALL_CARD_PITCH = 12;
/** How close to the spine a wall card must stand to count as the roadside hedge. */
export const WALL_VERGE_LIMIT = 48;
/** Metres between the shrubs planted along a wall card's base edge. */
export const WALL_SHRUB_STEP = 6;
export const WALL_SHRUB_MIN = 2.6;
export const WALL_SHRUB_MAX = 4.0;
/** Fraction of the card width the edge darkening reaches in from each vertical edge. */
export const WALL_EDGE_FADE = 0.22;
/** Brightness multiplier at the very edge (1 is unshaded). */
export const WALL_EDGE_DARK = 0.4;

/** True when a card's texture is part of the forest wall. */
export function isWallCard(textureNumber) {
  return WALL_TEXTURES.has(textureNumber);
}

/**
 * Nearest collision record to a point on the ground plane: `{index, distance, along}`, where `along`
 * is the distance along the route at that record plus the point's projection onto the record's
 * forward axis. `step` is the record spacing in metres. Null for a track without a spine.
 */
export function nearestSpine(spine, x, z, step = 4) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < spine.length; i++) {
    const p = spine[i].position;
    const d = (p[0] - x) ** 2 + (p[2] - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best === null) return null;
  const r = spine[best], p = r.position, f = r.forward;
  const n = Math.hypot(f[0], f[1], f[2]) || 1;
  const along = best * step + ((x - p[0]) * f[0] + (z - p[2]) * f[2]) / n;
  return { index: best, distance: Math.sqrt(bestD), along };
}

/** The along-route parity a card takes; odd mirrors the texture, so neighbouring cards alternate. */
export function wallMirror(along, pitch = WALL_CARD_PITCH) {
  const n = Math.floor(along / pitch);
  return ((n % 2) + 2) % 2 === 1;
}

/**
 * Triangles of one wall card with its vertical edges darkened. A four-corner card is split into
 * three columns so the colour can fall off from `WALL_EDGE_DARK` at each edge to white `fade` in,
 * which is the soft fold the reviewer asked for; a triangular card keeps its art and unshaded
 * colour. `mirror` flips u so alternate cards meet on matching edges. Returns
 * `[{ p: [a, b, c], uv: [[u, v] x3], col: [shade x3] }]`.
 */
export function wallCardTriangles(q, uv, { mirror = false, fade = WALL_EDGE_FADE, dark = WALL_EDGE_DARK } = {}) {
  const mir = ([u, v]) => [mirror ? 1 - u : u, v];
  const tri = (a, b, c) => ({ p: [a.p, b.p, c.p], uv: [a.uv, b.uv, c.uv], col: [a.col, b.col, c.col] });
  const at = (p, [u, v], col) => ({ p, uv: mir([u, v]), col });
  if (q.length !== 4) {
    const out = [tri(at(q[0], uv[0], 1), at(q[1], uv[1], 1), at(q[2], uv[2], 1))];
    if (q[2] !== q[3]) out.push(tri(at(q[0], uv[0], 1), at(q[2], uv[2], 1), at(q[3], uv[3], 1)));
    return out;
  }
  // The two corners standingCardUV put the image top on are the card's top edge, the two with v = 1
  // its base. Selecting them by v (not by Y) survives a card with a duplicated or tied corner,
  // where sorting by Y alone would pair a base corner with the top and tilt the columns.
  const byU = (a, b) => uv[a][0] - uv[b][0];
  const top = [...q.keys()].filter(i => uv[i][1] < 0.5).sort(byU);
  const bottom = [...q.keys()].filter(i => uv[i][1] >= 0.5).sort(byU);
  if (top.length !== 2 || bottom.length !== 2) {
    const out = [tri(at(q[0], uv[0], 1), at(q[1], uv[1], 1), at(q[2], uv[2], 1))];
    if (q[2] !== q[3]) out.push(tri(at(q[0], uv[0], 1), at(q[2], uv[2], 1), at(q[3], uv[3], 1)));
    return out;
  }
  const mixP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mixUV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const shade = t => (t <= 0 || t >= 1 ? dark : 1);
  const fracs = [0, fade, 1 - fade, 1];
  const columns = fracs.map(t => ({
    top: at(mixP(q[top[0]], q[top[1]], t), mixUV(uv[top[0]], uv[top[1]], t), shade(t)),
    bottom: at(mixP(q[bottom[0]], q[bottom[1]], t), mixUV(uv[bottom[0]], uv[bottom[1]], t), shade(t)),
  }));
  const out = [];
  for (let k = 0; k < columns.length - 1; k++) {
    const a = columns[k], b = columns[k + 1];
    out.push(tri(a.top, a.bottom, b.bottom), tri(a.top, b.bottom, b.top));
  }
  return out;
}

/**
 * A row of real shrubs along the wall's base, for the cards that stand near the route. Each card's
 * base edge is walked every `step` metres; the point is jittered in XZ and its height is jittered in
 * the shrub band, so the run breaks the wall's ground line instead of reading as a comb. The card's
 * art is not used as a scale: these are decoration, so they take the shrub band's own height.
 * `groundAt(x, z, baseY)` returns the terrain height under a point (null drops it).
 */
export function wallBasePlacements(cards, groundAt, spine, opts = {}) {
  const step = opts.step ?? WALL_SHRUB_STEP;
  const min = opts.min ?? WALL_SHRUB_MIN;
  const max = opts.max ?? WALL_SHRUB_MAX;
  const limit = opts.limit ?? WALL_VERGE_LIMIT;
  const placements = [];
  for (const card of cards) {
    // The two lowest corners are the card's base edge; the source quantises Y to 1/256 m, so an
    // epsilon test would miss the partner corner of a slanted base and leave the row unplanted.
    const corners = [...card.quad].sort((a, b) => a[1] - b[1]);
    if (corners.length < 3) continue;
    const [a, b] = corners;
    const bottom = a[1];
    const bx = (a[0] + b[0]) / 2, bz = (a[2] + b[2]) / 2;
    const near = nearestSpine(spine, bx, bz);
    if (!near || near.distance > limit) continue;
    const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.round(span / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t + (hash01(bx, bz, k) - 0.5) * step * 0.6;
      const z = a[2] + (b[2] - a[2]) * t + (hash01(bz, bx, k + 7) - 0.5) * step * 0.6;
      // The sidecar stores three decimals, so measure at the rounded point: a fraction of a millimetre
      // can fall off a triangle edge on a hillside and land the stored point on a different surface.
      const px = +x.toFixed(3), pz = +z.toFixed(3);
      const ground = groundAt(px, pz, bottom);
      if (ground === null || ground === undefined) continue;
      // The mesh can draw a flat canopy above the card's base. Re-query from the chosen height: only a
      // surface that is its own nearest ground is stable, so an ambiguous stack is dropped instead of
      // planting a shrub on the wrong one.
      const settled = groundAt(px, pz, ground);
      if (settled === null || settled === undefined || Math.abs(settled - ground) > 0.5) continue;
      const height = min + hash01(px, pz, 3) * (max - min);
      placements.push([px, ground, pz, +height.toFixed(3)]);
    }
  }
  return dedupeStands(placements);
}
