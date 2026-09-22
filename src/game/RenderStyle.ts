import * as THREE from 'three';

/**
 * Whole-scene shading styles.
 *
 * These are not screen filters: each one swaps the materials the scene is drawn with, so the
 * lighting itself changes. Cartoon banding comes from a toon ramp reacting to the same sun the
 * normal look uses, not from posterising the finished picture - which is why an outline lands on
 * the silhouette instead of on every noisy texel.
 *
 * `off` puts the originals back. Nothing is disposed on the way through: the originals have to
 * survive being switched away from and back.
 */
export const STYLES = ['off', 'cartoon', 'matcap', 'clay', 'wire', 'normal'] as const;
export type Style = (typeof STYLES)[number];

/** Knobs the tuning panel drives; the defaults are what ships. */
export type StyleTuning = {
 /** How far the outline hull is pushed out along the normals, in metres. */
 outline: number;
 /** Steps in the toon ramp: three reads as a cartoon, more reads as a bad render. */
 steps: number;
 /** How dark the darkest toon step is, 0 black to 1 unshaded. */
 floor: number;
};

/**
 * Chosen on screen with the `?tune` panel, not guessed here: a thin ink line, two toon steps and
 * a high floor, so the shading reads as drawn without the world going flat.
 */
export const STYLE_DEFAULTS: StyleTuning = { outline: 0.035, steps: 2, floor: 0.8 };

/** What the drive is drawn in unless something asks for another. */
export const DEFAULT_STYLE: Style = 'cartoon';

/** A hard-stepped ramp for MeshToonMaterial; the steps are what makes the shading read as drawn. */
function toonRamp(steps: number, floor: number): THREE.DataTexture {
 const data = new Uint8Array(steps * 4);
 for (let i = 0; i < steps; i++) {
  // Keep the darkest step off black, or everything facing away from the sun is a hole.
  const value = Math.round(255 * (floor + (1 - floor) * (i / Math.max(1, steps - 1))));
  data.set([value, value, value, 255], i * 4);
 }
 const texture = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.needsUpdate = true;
 return texture;
}

/** A soft studio matcap, built rather than loaded: a lit sphere in a 128 px disc. */
function matcap(): THREE.CanvasTexture {
 const size = 128;
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = size;
 const ctx = canvas.getContext('2d')!;
 ctx.fillStyle = '#0b0d10';
 ctx.fillRect(0, 0, size, size);
 const body = ctx.createRadialGradient(size * 0.36, size * 0.3, size * 0.05, size * 0.5, size * 0.5, size * 0.52);
 body.addColorStop(0, '#ffffff');
 body.addColorStop(0.35, '#b9c4cc');
 body.addColorStop(0.75, '#4d5a66');
 body.addColorStop(1, '#141a20');
 ctx.fillStyle = body;
 ctx.beginPath();
 ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
 ctx.fill();
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 return texture;
}

type Swapped = { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] };

export class RenderStyle {
 private style: Style = 'off';
 private readonly swapped: Swapped[] = [];
 private readonly outlines: THREE.Object3D[] = [];
 private readonly made: THREE.Material[] = [];
 private ramp?: THREE.DataTexture;
 private cap?: THREE.CanvasTexture;
 private scene?: THREE.Object3D;
 private outlined?: THREE.Object3D;
 readonly tuning: StyleTuning = { ...STYLE_DEFAULTS };

 /** Changes a knob and redraws in the current style, so the panel shows it at once. */
 tune(key: keyof StyleTuning, value: number): void {
  this.tuning[key] = value;
  this.ramp?.dispose();
  this.ramp = undefined;
  if (this.scene) this.apply(this.scene, this.style, this.outlined);
 }

 get current(): Style { return this.style; }

 /**
  * Draws `scene` in `style`. Switching to 'off' restores every material it took.
  *
  * `outlined` is what gets a cartoon outline - in practice the cars. An outline is a second draw
  * of everything it touches, so a whole track is not worth it, while on the car it is the line
  * that makes the picture look drawn.
  */
 apply(scene: THREE.Object3D, style: Style, outlined?: THREE.Object3D): void {
  this.restore();
  this.style = style;
  this.scene = scene;
  this.outlined = outlined;
  if (style === 'off') return;
  const cache = new Map<THREE.Material, THREE.Material>();
  scene.traverse(node => {
   const mesh = node as THREE.Mesh;
   // The sky ring is the backdrop, and a custom shader owns its whole look: the sea is a
   // ShaderMaterial, and swapping it for a toon material threw the shader away and left a white
   // sheet where the water had been. Anything that brought its own program keeps it.
   if (!mesh.isMesh || mesh.name === 'horizon' || !mesh.material) return;
   const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
   if (materials.some(material => (material as THREE.ShaderMaterial).isShaderMaterial)) return;
   this.swapped.push({ mesh, original: mesh.material });
   const styled = materials.map(material => {
    const seen = cache.get(material);
    if (seen) return seen;
    const made = this.restyle(material as THREE.MeshStandardMaterial, style);
    cache.set(material, made);
    this.made.push(made);
    return made;
   });
   mesh.material = Array.isArray(mesh.material) ? styled : styled[0];
  });
  if (style === 'cartoon' && outlined) this.outline(outlined);
 }

 private restyle(source: THREE.MeshStandardMaterial, style: Style): THREE.Material {
  const shared = {
   name: source.name,
   map: source.map ?? null,
   alphaMap: source.alphaMap ?? null,
   alphaTest: source.alphaTest,
   transparent: source.transparent,
   opacity: source.opacity,
   side: source.side,
   vertexColors: source.vertexColors,
  };
  switch (style) {
   case 'cartoon':
    this.ramp ??= toonRamp(Math.max(2, Math.round(this.tuning.steps)), this.tuning.floor);
    return new THREE.MeshToonMaterial({ ...shared, color: source.color ?? 0xffffff, gradientMap: this.ramp });
   case 'matcap':
    this.cap ??= matcap();
    return new THREE.MeshMatcapMaterial({ ...shared, color: source.color ?? 0xffffff, matcap: this.cap });
   case 'clay':
    // One tone for everything: the form on its own, with no texture to read it through.
    return new THREE.MeshStandardMaterial({
     name: source.name, color: 0xcdc3b4, roughness: 0.94, metalness: 0,
     alphaMap: shared.alphaMap, alphaTest: shared.alphaTest, transparent: shared.transparent,
     opacity: shared.opacity, side: shared.side,
    });
   case 'wire':
    return new THREE.MeshBasicMaterial({ name: source.name, color: 0x7de8c3, wireframe: true, transparent: true, opacity: 0.55 });
   case 'normal':
    return new THREE.MeshNormalMaterial({ name: source.name, side: shared.side, flatShading: false });
   default:
    return source;
  }
 }

 /**
  * The cartoon outline: the same mesh again, inside out and pushed along its normals, in flat
  * black. Only the vehicles get one - it is a second draw of everything it touches, and on a
  * whole track that is not worth it, while on the car it is the line that makes it look drawn.
  */
 private outline(root: THREE.Object3D): void {
  const material = new THREE.MeshBasicMaterial({ color: 0x0b0b0d, side: THREE.BackSide });
  this.made.push(material);
  const targets: THREE.Mesh[] = [];
  root.traverse(node => {
   const mesh = node as THREE.Mesh;
   if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
   if (mesh.name === 'cartoon-outline' || !mesh.geometry.getAttribute('normal')) return;
   targets.push(mesh);
  });
  for (const mesh of targets) {
   const hull = new THREE.Mesh(mesh.geometry, material);
   hull.name = 'cartoon-outline';
   hull.scale.setScalar(1 + this.tuning.outline / Math.max(0.2, boundingRadius(mesh)));
   hull.renderOrder = -1;
   mesh.add(hull);
   this.outlines.push(hull);
  }
 }

 private restore(): void {
  for (const hull of this.outlines) hull.removeFromParent();
  this.outlines.length = 0;
  for (const { mesh, original } of this.swapped) mesh.material = original;
  this.swapped.length = 0;
  for (const material of this.made) material.dispose();
  this.made.length = 0;
 }
}

function boundingRadius(mesh: THREE.Mesh): number {
 if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
 return mesh.geometry.boundingSphere?.radius ?? 1;
}
