import * as THREE from 'three';

/**
 * A waterfall: a falling curtain, the spray where it lands, and the mist above that.
 *
 * All three are drawn from one generated texture scrolled at different rates, which is what a
 * falling sheet of water is - streaks that never repeat at the same moment. Nothing here is
 * simulated; a fall is scenery you pass at 200 km/h.
 */
export type WaterfallSpec = {
 /** Foot of the fall, in world metres. */
 x: number; z: number;
 /** Height of the lip above the foot. */
 height: number;
 width: number;
 /** Which way the curtain faces, radians; 0 faces -Z, the same convention the cars use. */
 yaw: number;
};

/** Metres a streak travels per second for a fall of `height` metres, from v = sqrt(2gh) halved. */
export const fallSpeed = (height: number): number => Math.min(28, Math.sqrt(2 * 9.81 * Math.max(1, height)) * 0.5);

/** How wide the spray at the foot is, against the curtain's own width. */
const SPRAY_SPREAD = 1.7;
/** How far up the mist climbs, against the fall's height. */
const MIST_RISE = 0.22;

/**
 * Vertical streaks with a soft edge: the curtain's own texture, scrolled downward.
 *
 * The canvas is left transparent and only the streaks are painted. Filling it first is what makes
 * a fall read as a white slab hanging off a bank: falling water is mostly the gaps.
 */
function streaks(size = 256): THREE.CanvasTexture {
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = size;
 const ctx = canvas.getContext('2d')!;
 let seed = 20250919;
 const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
 for (let i = 0; i < 260; i++) {
  const x = random() * size, w = 1 + random() * 4;
  const top = random() * size, length = size * (0.25 + random() * 0.75);
  const shade = Math.round(150 + random() * 105);
  const gradient = ctx.createLinearGradient(0, top, 0, top + length);
  gradient.addColorStop(0, `rgba(${shade},${shade + 12},${shade + 18},0)`);
  gradient.addColorStop(0.5, `rgba(${shade},${shade + 12},${shade + 18},.9)`);
  gradient.addColorStop(1, `rgba(${shade},${shade + 12},${shade + 18},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, top, w, length);
  // The strip has to wrap, so whatever ran off the bottom comes back at the top.
  if (top + length > size) ctx.fillRect(x, top - size, w, length);
 }
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 return texture;
}

export class Waterfall {
 readonly group = new THREE.Group();
 private readonly maps: THREE.Texture[] = [];
 private readonly rates: number[] = [];

 private readonly spec: WaterfallSpec;
 private constructor(spec: WaterfallSpec) { this.spec = spec; }

 static build(spec: WaterfallSpec): Waterfall {
  const fall = new Waterfall(spec);
  const speed = fallSpeed(spec.height);
  const sheet = (width: number, height: number, y: number, z: number, opacity: number, repeat: number, rate: number) => {
   const map = streaks();
   map.repeat.set(Math.max(1, Math.round(width / 6)), repeat);
   const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height, 1, 8),
    new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: true }),
   );
   mesh.position.set(0, y, z);
   fall.group.add(mesh);
   fall.maps.push(map);
   fall.rates.push(rate);
   return mesh;
  };

  // The curtain, and a second sheet just in front of it running faster: one sheet alone reads as
  // a sliding poster, two at different rates read as depth.
  sheet(spec.width, spec.height, spec.height / 2, 0, 0.85, Math.max(2, Math.round(spec.height / 8)), speed / spec.height);
  sheet(spec.width * 0.8, spec.height, spec.height / 2, 0.35, 0.5, Math.max(2, Math.round(spec.height / 11)), speed / spec.height * 1.6);
  // Spray where it lands, and the mist that drifts up off it.
  sheet(spec.width * SPRAY_SPREAD, spec.height * 0.16, spec.height * 0.06, 0.8, 0.5, 1, -speed / spec.height * 0.5);
  sheet(spec.width * SPRAY_SPREAD * 1.2, spec.height * MIST_RISE, spec.height * 0.16, 1.1, 0.22, 1, -speed / spec.height * 0.25);

  fall.group.position.set(spec.x, 0, spec.z);
  fall.group.rotation.y = spec.yaw;
  fall.group.name = 'waterfall';
  return fall;
 }

 /** Scrolls the sheets. `dt` is seconds. */
 update(dt: number): void {
  for (let i = 0; i < this.maps.length; i++) this.maps[i].offset.y -= this.rates[i] * dt;
 }

 /** The world-space foot of the fall, for anything that needs to know where the water lands. */
 get foot(): THREE.Vector3 { return new THREE.Vector3(this.spec.x, 0, this.spec.z); }

 dispose(): void {
  for (const map of this.maps) map.dispose();
  this.group.traverse(node => {
   if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
  });
 }
}
