import * as THREE from 'three';

const SIZE = 256;

/**
 * Wrapping value noise on a `cells` x `cells` lattice, smoothed with a cosine fade. Plain per-texel
 * noise is what this used to be, and at any distance the mip chain averages it straight back to a
 * flat colour - which is exactly how the terrain read. Low-frequency cells survive the mips, so
 * the ground keeps a patchy grain all the way to the horizon.
 */
function lattice(cells: number, seed: number): (u: number, v: number) => number {
 const values = new Float32Array(cells * cells);
 let state = seed >>> 0;
 for (let i = 0; i < values.length; i++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  values[i] = state / 4294967296;
 }
 const at = (x: number, y: number) => values[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
 const fade = (t: number) => (1 - Math.cos(t * Math.PI)) / 2;
 return (u, v) => {
  const x = Math.floor(u), y = Math.floor(v), fx = fade(u - x), fy = fade(v - y);
  const top = at(x, y) + (at(x + 1, y) - at(x, y)) * fx;
  const bottom = at(x, y + 1) + (at(x + 1, y + 1) - at(x, y + 1)) * fx;
  return top + (bottom - top) * fy;
 };
}

/** Seeded material grain that keeps large terrain and road surfaces readable at driving distance. */
export function surfaceTexture(kind: 'asphalt' | 'ground'): THREE.CanvasTexture {
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = SIZE;
 const ctx = canvas.getContext('2d')!;
 const image = ctx.createImageData(SIZE, SIZE);
 // Patches, clumps and the fine grain on top: the first two are what is still there a hundred
 // metres out, the third is what the surface looks like under the wheels.
 const patches = lattice(4, 9217), clumps = lattice(16, 4441), fine = lattice(64, 7703);
 const base = kind === 'asphalt' ? 168 : 150;
 const swing = kind === 'asphalt' ? 54 : 84;
 for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  const u = x / SIZE, v = y / SIZE;
  const n = patches(u * 4, v * 4) * 0.5 + clumps(u * 16, v * 16) * 0.32 + fine(u * 64, v * 64) * 0.18;
  const value = base + n * swing;
  image.data.set([value, value, value, 255], (y * SIZE + x) * 4);
 }
 ctx.putImageData(image, 0, 0);
 if (kind === 'asphalt') {
  ctx.strokeStyle = 'rgba(40,40,40,.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 130); ctx.lineTo(73, 125); ctx.lineTo(91, 142); ctx.lineTo(158, 150);
  ctx.stroke();
 }
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 return texture;
}
