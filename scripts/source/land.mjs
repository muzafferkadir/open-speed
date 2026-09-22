// Where the ground is around a route, read from the original track mesh.
//
// The route itself is the COL collision spine, but the land is not: the TRK mesh draws the beach,
// the aprons and the sea floor, and a sprite the source placed far off the corridor can stand on
// water the spine knows nothing about. Sampling the mesh triangles around a point (the same top-down
// triangle grid) says whether there is ground under it and
// at what height, which is what a replacement prop needs before it is planted.

/** Largest |y| the sea floor reaches on Last Resort; nothing below this is land. */
export const WATER_LEVEL = -1;

/** |surface normal . up| at or above which a triangle counts as ground rather than a wall/slope. */
const FLAT = 0.9;

const CELL = 32;

/**
 * Index of the track mesh triangles: a top-down grid of triangle indices whose XZ bounds touch a
 * cell. `sample` then only tests the handful of triangles over a point instead of all 37k.
 */
export class LandField {
 constructor(positions, indices) {
  this.cells = new Map();
  this.tris = [];
  for (let t = 0; t < indices.length; t += 3) {
   const tri = [indices[t], indices[t + 1], indices[t + 2]].map(i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
   this.tris.push(tri);
   const minX = Math.min(tri[0][0], tri[1][0], tri[2][0]), maxX = Math.max(tri[0][0], tri[1][0], tri[2][0]);
   const minZ = Math.min(tri[0][2], tri[1][2], tri[2][2]), maxZ = Math.max(tri[0][2], tri[1][2], tri[2][2]);
   for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
     const key = `${cx},${cz}`;
     const list = this.cells.get(key) ?? this.cells.set(key, []).get(key);
     list.push(this.tris.length - 1);
    }
  }
 }

 /**
  * Highest surface of the track mesh over `(x, z)`: the topmost triangle that contains the point,
  * else the nearest triangle within `reach` (the mesh is a triangle soup with gaps).
  */
 sample(x, z, reach = 6) {
  const near = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
  let top = null, bestD = reach * reach, nearY = null;
  const test = (tri) => {
   const [a, b, c] = tri;
   const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
   if (area !== 0) {
    const w1 = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
    const w2 = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
    const w3 = 1 - w1 - w2;
    if (w1 >= -1e-6 && w2 >= -1e-6 && w3 >= -1e-6) {
     const y = w1 * a[1] + w2 * b[1] + w3 * c[1];
     if (top === null || y > top) top = y;
     return;
    }
   }
   // Otherwise remember the nearest triangle's height, for a point that fell in a gap.
   const dx = [a[0] - x, b[0] - x, c[0] - x], dz = [a[2] - z, b[2] - z, c[2] - z];
   const d = Math.min(dx[0] * dx[0] + dz[0] * dz[0], dx[1] * dx[1] + dz[1] * dz[1], dx[2] * dx[2] + dz[2] * dz[2]);
   if (d < bestD) { bestD = d; nearY = Math.max(a[1], b[1], c[1]); }
  };
  if (near.length) for (const i of near) test(this.tris[i]);
  // A point with no cell hit is far outside the geometry: fall back to the nearest triangle.
  else for (const tri of this.tris) test(tri);
  return top ?? nearY;
 }

 /** True when the mesh draws ground (not sea floor) over `(x, z)`. */
 isLand(x, z, reach = 6) {
  const y = this.sample(x, z, reach);
  return y !== null && y > WATER_LEVEL;
 }

 /**
  * The surface a prop actually stands on, out of the several the mesh may draw over one `(x, z)`:
  * a near-horizontal surface when the mesh has one (a slanted bank, a card or a floating structure
  * can cover the same point from above), otherwise the surface nearest `reference` (the sprite
  * card's own base edge). `sample` takes the topmost surface, which is right for "is there ground
  * here" but wrong for a plant: it put shrubs on the sloped roofs 7 m over the beach. `reference`
  * is optional; without it this is `sample`.
  */
 groundAt(x, z, reference, reach = 6) {
  if (reference === undefined) return this.sample(x, z, reach);
  const near = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
  let best = null, bestRank = Infinity, nearY = null, nearDist = reach * reach;
  const consider = (y, up) => {
   // Rank: a flat surface first, then the one nearest the card's own base among equals.
   const rank = (up >= FLAT ? 0 : 1) * 1e6 + Math.abs(y - reference);
   if (rank < bestRank) { bestRank = rank; best = y; }
  };
  const test = (tri) => {
   const [a, b, c] = tri;
   const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
   if (area !== 0) {
    const w1 = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
    const w2 = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
    const w3 = 1 - w1 - w2;
    if (w1 >= -1e-6 && w2 >= -1e-6 && w3 >= -1e-6) {
     consider(w1 * a[1] + w2 * b[1] + w3 * c[1], upness(a, b, c));
     return;
    }
   }
   const dx = [a[0] - x, b[0] - x, c[0] - x], dz = [a[2] - z, b[2] - z, c[2] - z];
   const d = Math.min(dx[0] * dx[0] + dz[0] * dz[0], dx[1] * dx[1] + dz[1] * dz[1], dx[2] * dx[2] + dz[2] * dz[2]);
   if (d < nearDist) { nearDist = d; nearY = Math.max(a[1], b[1], c[1]); }
  };
  if (near.length) for (const i of near) test(this.tris[i]);
  else for (const tri of this.tris) test(tri);
  return best ?? nearY;
 }
}

/** |surface normal . up| of a triangle: 1 is a flat floor, 0 a vertical wall. */
function upness(a, b, c) {
 const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
 const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
 const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
 return Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
}
