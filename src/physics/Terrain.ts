// Continuous world-space terrain shared by rendering, map generation and physics.
export type Landscape = {
 coast: { rx: number; rz: number };
 lake: { x: number; z: number; rx: number; rz: number };
 waterLevel: number;
 maxWadeDepth: number;
};
export type Biome = 'coast' | 'alpine' | 'beach' | 'forest' | 'town' | 'harbor';
const smooth = (a: number, b: number, v: number) => {
 const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
 return t * t * (3 - 2 * t);
};
export function shoreDistance(p: Landscape, x: number, z: number): number {
 const a = Math.atan2(z / p.coast.rz, x / p.coast.rx);
 const coast = (1 + 0.055 * Math.sin(a * 3 + 0.4) + 0.025 * Math.sin(a * 7) - Math.hypot(x / p.coast.rx, z / p.coast.rz)) * Math.min(p.coast.rx, p.coast.rz);
 const lx = x - p.lake.x, lz = z - p.lake.z;
 const la = Math.atan2(lz / p.lake.rz, lx / p.lake.rx);
 const lake = (Math.hypot(lx / p.lake.rx, lz / p.lake.rz) - 1 - 0.06 * Math.sin(la * 3)) * Math.min(p.lake.rx, p.lake.rz);
 return Math.min(coast, lake);
}
export function biomeAt(x: number, z: number): Biome {
 if (z < -260) return 'alpine';
 if (x < -300) return 'coast';
 if (z > 270 && x < 150) return 'beach';
 if (x > 270 && z > 120) return 'harbor';
 if (x > 150) return 'town';
 return 'forest';
}
export function terrainHeight(p: Landscape, x: number, z: number): number {
 const shore = shoreDistance(p, x, z);
 // A broad submerged shelf permits turning and reversing before the deep-water limit.
 if (shore < 0) return p.waterLevel + Math.max(-12, shore * 0.035);
 const inland = smooth(0, 85, shore);
 const hills = 2.2 + 1.2 * Math.sin(x / 160) * Math.cos(z / 190);
 const mountains = 42 * Math.exp(-(((x + 65) / 250) ** 2) - ((z + 470) / 150) ** 2);
 return p.waterLevel + shore * 0.035 * (1 - inland) + (hills + mountains) * inland;
}
export function waterDepth(p: Landscape, x: number, z: number): number {
 return Math.max(0, p.waterLevel - terrainHeight(p, x, z));
}
