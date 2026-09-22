// Quad UV layout for the source track geometry. Kept separate from the extractor so tests can pin the
// standing-card rule (the "upside-down palm" bug) without running the whole TRK conversion.

// Quad corner UVs for a HORIZONTAL quad (road/apron), matching the winding 0-1-2-3 used by
// the loader convention: edge 0-1 is the first horizontal edge, so u runs along it and v across the quad.
export const UV = [[1, 1], [0, 1], [0, 0], [1, 0]];

/** Rotate a quad UV by `n * 90 deg` about (0.5, 0.5), the way the source loader scales them. */
export function rotateUV([u, v], n) {
  for (let k = 0; k < n; k++) { const du = u - 0.5, dv = v - 0.5; u = 0.5 + dv; v = 0.5 - du; }
  return [u, v];
}

const DY = (a, b) => Math.abs(a[1] - b[1]);
const DXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const span = (q, axis) => Math.max(...q.map((p) => p[axis])) - Math.min(...q.map((p) => p[axis]));
export const isHorizontal = (a, b) => DXZ(a, b) > DY(a, b) * 4;
export const isVertical = (a, b) => DY(a, b) > DXZ(a, b) * 4;

export const MIN_CARD_HEIGHT = 1.5;

/**
 * A billboard/wall/tree card stands on the vertical plane: it has real height and is thin in the
 * horizontal plane, so its height dwarfs its horizontal footprint. Roads, aprons and irregular
 * terrain quads are flat (near-zero height) and must keep the plain table.
 *
 * The old test only accepted a clean 2-horizontal / 2-vertical rectangle, so skewed quads and the
 * triangular foliage cards kept the road table and still rendered upside down (user report
 * 2026-09-18). Using the quad's own extents catches those too while leaving flat ground alone.
 */
export function isStandingCard(q) {
  const height = span(q, 1);
  if (height < MIN_CARD_HEIGHT) return false;
  const footprint = (span(q, 0) + span(q, 2)) / 2;
  return height > footprint;
}

/**
 * UVs for a standing card, derived from its geometry because the source winding is not fixed: a
 * wall/tree card is stored either (top-A, bottom-A, bottom-B, top-B) or (top-A, top-B, bottom-B,
 * bottom-A). The plain table put the image bottom (v = 1) on the top corner, so cut-out sprites
 * rendered upside down (trunk up, fronds in the sand). Here the higher corners always take v = 0
 * (image top) and the lower corners v = 1, while u runs along the card's horizontal edge so the
 * art is not mirrored. Works for both quads and the triangular cards by using the most horizontal
 * edge of the winding.
 */
export function standingCardUV(q) {
  const n = q.length;
  const edges = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  let best = edges[0], bestRun = -1;
  for (const e of edges) {
    const run = DXZ(q[e[0]], q[e[1]]);
    if (run > bestRun) { bestRun = run; best = e; }
  }
  const [ha, hb] = best;
  const dx = q[hb][0] - q[ha][0], dz = q[hb][2] - q[ha][2];
  const len2 = dx * dx + dz * dz || 1;
  // u runs along the card's widest horizontal edge and is normalised over the quad's own span, so
  // a skewed or triangular card still lands inside [0, 1] instead of sampling past the texture.
  const proj = q.map((p) => ((p[0] - q[ha][0]) * dx + (p[2] - q[ha][2]) * dz) / len2);
  const uMin = Math.min(...proj), uMax = Math.max(...proj);
  const uSpan = uMax - uMin || 1;
  const ys = q.map((p) => p[1]);
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return q.map((p, i) => [1 - (proj[i] - uMin) / uSpan, p[1] >= midY ? 0 : 1]);
}

/** The UV table for a quad: geometric for a standing card, the plain road table otherwise. */
export function uvTableFor(q) {
  return isStandingCard(q) ? standingCardUV(q) : UV;
}
