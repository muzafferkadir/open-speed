/**
 * Car-to-car contact.
 *
 * The old response was a circle against a circle with one impulse along the line of centres, and
 * then a flat 3% off both cars' speed. That last part is what made it feel wrong: being rear-ended
 * slowed the car in front down, when a shunt from behind should push it along. A circle also
 * cannot tell a nose-to-tail shunt from a side-swipe, so every contact felt the same.
 *
 * A car is two discs on its own axis instead - a capsule - which is enough to give a contact
 * normal that knows front from side, and the response is the standard impulse for two bodies with
 * mass: separation along the normal, a scrub along the tangent, nothing taken off the top.
 */

/** Yaw 0 faces -Z, the same convention the rest of the physics uses. */
export type Body = {
 x: number; z: number; yaw: number;
 vx: number; vz: number;
 mass: number;
 /** Half the car's length and width, in metres. */
 halfLength: number; halfWidth: number;
};

export type Contact = {
 /** Unit normal, pointing from `a` to `b`. */
 nx: number; nz: number;
 /** How far the two overlap along the normal, in metres. */
 depth: number;
};

/** How much of the closing speed is given back as a bounce. Arcade: enough to feel, not to launch. */
export const RESTITUTION = 0.25;
/** How much of the sideways slide between two touching cars is scrubbed off. */
export const SCRUB = 0.45;
/** Closing speed (m/s) above which the impulse stops growing, so a 200 km/h shunt cannot launch. */
export const MAX_CLOSING = 26;

/** The two disc centres of a car's capsule, front first. */
function discs(body: Body, out: number[]): number[] {
 const reach = Math.max(0, body.halfLength - body.halfWidth);
 const fx = -Math.sin(body.yaw) * reach, fz = -Math.cos(body.yaw) * reach;
 out[0] = body.x + fx; out[1] = body.z + fz;
 out[2] = body.x - fx; out[3] = body.z - fz;
 return out;
}

const discsA: number[] = [0, 0, 0, 0], discsB: number[] = [0, 0, 0, 0];

/** The deepest overlap between two cars, or null when they are apart. */
export function contact(a: Body, b: Body): Contact | null {
 discs(a, discsA);
 discs(b, discsB);
 const radius = a.halfWidth + b.halfWidth;
 let best: Contact | null = null;
 for (let i = 0; i < 4; i += 2) for (let j = 0; j < 4; j += 2) {
  const dx = discsB[j] - discsA[i], dz = discsB[j + 1] - discsA[i + 1];
  const distance = Math.hypot(dx, dz);
  if (distance >= radius) continue;
  const depth = radius - distance;
  if (best && depth <= best.depth) continue;
  // Two discs exactly on top of each other have no direction; push along the cars' own line.
  const fallback = Math.hypot(b.x - a.x, b.z - a.z);
  best = distance > 1e-6
   ? { nx: dx / distance, nz: dz / distance, depth }
   : { nx: fallback > 1e-6 ? (b.x - a.x) / fallback : 1, nz: fallback > 1e-6 ? (b.z - a.z) / fallback : 0, depth };
 }
 return best;
}

export type Response = {
 /** Metres each car is moved apart along the normal. */
 separation: number;
 /** World-space velocity change for each car. */
 ax: number; az: number;
 bx: number; bz: number;
};

/**
 * The impulse two touching cars exchange. Nothing is taken off the top: a car shunted from behind
 * gains the speed the car behind loses, which is the whole point.
 */
export function respond(a: Body, b: Body, hit: Contact): Response {
 const separation = hit.depth / 2;
 const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
 const vn = rvx * hit.nx + rvz * hit.nz;
 if (vn >= 0) return { separation, ax: 0, az: 0, bx: 0, bz: 0 };
 const closing = Math.max(vn, -MAX_CLOSING);
 const inverseMass = 1 / a.mass + 1 / b.mass;
 const j = (-(1 + RESTITUTION) * closing) / inverseMass;
 // Tangential scrub: a side-swipe rubs speed off, a straight shunt barely notices it.
 const tx = -hit.nz, tz = hit.nx;
 const vt = rvx * tx + rvz * tz;
 // Positive pulls `a` toward `b`'s sideways motion, which is what rubbing along does; capped
 // against the normal impulse so a light touch cannot scrub more than it presses.
 const jt = Math.max(-SCRUB * j, Math.min(SCRUB * j, vt / inverseMass));
 return {
  separation,
  ax: (-hit.nx * j + tx * jt) / a.mass,
  az: (-hit.nz * j + tz * jt) / a.mass,
  bx: (hit.nx * j - tx * jt) / b.mass,
  bz: (hit.nz * j - tz * jt) / b.mass,
 };
}
