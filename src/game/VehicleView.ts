import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CarState } from '../physics/types.js';
import { REST_COMPRESSION_FRONT, REST_COMPRESSION_REAR, SUSP_TRAVEL } from '../physics/Car.js';
import type { VehicleDesign, WheelView } from './types.js';
import { lampSites, type LampConfig, type LampPlacement } from './lamps.js';

/** The handles the paint shader is driven by: the colour, whether it is on, and the hue band. */
type PaintUniforms = {
 uPaint: { value: THREE.Color };
 uPaintOn: { value: number };
 uBand: { value: THREE.Vector2 };
 /** 1 where the car's paint has no hue to key on and paleness stands in for it. */
 uPale: { value: number };
};

/**
 * Satin car paint: the raw bake is a mirror, which makes every mesh seam glare
 * under a studio light. Copying into MeshPhysicalMaterial breaks the clearcoat
 * uniforms, so just tame the standard material.
 */
/**
 * Car paint, not a mirror. Sources arrive with metalness up near 1 and a low roughness, which under
 * a bright sky environment turns the whole bonnet into a white reflection that then blooms; real
 * paint is a dielectric with a clearcoat, so what it wants is a little metalness, a rougher
 * surface and a much quieter environment.
 */
function satin(source: THREE.Material, wheel = false): THREE.Material {
 const material = source.clone();
 if (material instanceof THREE.MeshStandardMaterial) {
  // A wheel is not paint. Its maps already say which part of it is rubber and which is polished
  // rim, and clamping that away is what left an alloy wheel reading as painted plastic. It is not
  // chrome either, so the metal it keeps is turned down to cast aluminium.
  material.roughness = Math.max(material.roughness, wheel ? 1 : .55);
  material.metalness = Math.min(material.metalness, wheel ? .7 : .12);
  material.envMapIntensity = wheel ? .4 : .45;
 }
 return material;
}

/**
 * Re-hue the baked paint of a base colour texture: texels whose hue falls in `range` (and that are
 * saturated enough to be paint rather than tyre, glass or chrome) take the tint's hue and
 * saturation while keeping their own shading. Returns a new texture with the source's sampling.
 */

/**
 * Repaints the body on the GPU.
 *
 * The baked texture carries one paint colour, and the panels are the only part of it whose hue
 * sits in a known band - glass, rubber, lamps and the cabin fall outside it. So the shader looks
 * at each texel as it is sampled, and where the hue is in that band it keeps the shading and
 * swaps the colour. Nothing is copied, nothing is re-uploaded: the colour is a uniform, so a
 * swatch is a value change rather than a new texture per colour.
 *
 * A white car has no hue to key on. There the panels are instead the part of the texture that is
 * pale - washed of colour and bright - which the glass, the grille and the cabin are not, and the
 * rim is not either now that a fitted wheel brings its own material.
 */
function paintable(material: THREE.MeshStandardMaterial, band: [number, number] | undefined, pale: boolean): PaintUniforms | null {
 if (!material.map) return null;
 const uniforms: PaintUniforms = {
  uPaint: { value: new THREE.Color(1, 1, 1) },
  uPaintOn: { value: 0 },
  uBand: { value: new THREE.Vector2((band?.[0] ?? 0) / 360, (band?.[1] ?? 0) / 360) },
  uPale: { value: pale ? 1 : 0 },
 };
 material.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = `
   uniform vec3 uPaint;
   uniform float uPaintOn;
   uniform vec2 uBand;
   uniform float uPale;
   // Anything with a hue and some light in it is paint. A tail lens is the same red as the
   // bodywork around it, so it repaints too; the game lights its own lamps over the top.
   const float LENS_DARK = 0.05;
   vec3 rgb2hsl(vec3 c) {
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float l = (mx + mn) * 0.5, h = 0.0, s = 0.0;
    if (mx > mn) {
     float d = mx - mn;
     s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
     if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
     else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
     else h = (c.r - c.g) / d + 4.0;
     h /= 6.0;
    }
    return vec3(h, s, l);
   }
   float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 0.5) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
   }
   vec3 hsl2rgb(vec3 c) {
    if (c.y == 0.0) return vec3(c.z);
    float q = c.z < 0.5 ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
    float p = 2.0 * c.z - q;
    return vec3(hue2rgb(p, q, c.x + 1.0 / 3.0), hue2rgb(p, q, c.x), hue2rgb(p, q, c.x - 1.0 / 3.0));
   }
   ${shader.fragmentShader}
  `.replace('#include <map_fragment>', `
   #include <map_fragment>
   if (uPaintOn > 0.5) {
    vec3 hsl = rgb2hsl(sampledDiffuseColor.rgb);
    // The band may wrap through red, which is where most car paint sits.
    bool inBand = uBand.x <= uBand.y ? (hsl.x >= uBand.x && hsl.x <= uBand.y) : (hsl.x >= uBand.x || hsl.x <= uBand.y);
    bool isPaint = uPale > 0.5
     ? (hsl.y < 0.16 && hsl.z > 0.44)
     : (inBand && hsl.y > 0.25 && hsl.z > LENS_DARK && hsl.z < 0.96);
    if (isPaint) {
     vec3 target = rgb2hsl(uPaint);
     // The texel keeps its own shading; only the hue and how saturated it is come from the swatch.
     // White paint is light everywhere, so keeping its lightness outright turns every swatch into
     // a pastel of itself. There the shading is kept as a ratio and hung on the swatch instead.
     float lit = uPale > 0.5
      ? target.z * hsl.z / 0.78
      : hsl.z + (target.z - 0.5) * 0.5;
     vec3 repainted = hsl2rgb(vec3(target.x, target.y, clamp(lit, 0.03, 0.97)));
     diffuseColor.rgb = repainted;
    }
   }
  `);
 };
 material.needsUpdate = true;
 return uniforms;
}

function recolorPaint(source: THREE.Texture, range: [number, number], tint: THREE.Color): THREE.Texture {
 const image = source.image as CanvasImageSource & { width: number; height: number };
 const canvas = document.createElement('canvas');
 canvas.width = image.width;
 canvas.height = image.height;
 const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
 ctx.drawImage(image, 0, 0);
 const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
 const data = pixels.data;
 const target = { h: 0, s: 0, l: 0 };
 tint.getHSL(target);
 const [lo, hi] = [range[0] / 360, range[1] / 360];
 const color = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
 for (let i = 0; i < data.length; i += 4) {
  color.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.h < lo || hsl.h > hi || hsl.s < .3 || hsl.l < .06 || hsl.l > .96) continue;
  const l = THREE.MathUtils.clamp(hsl.l + (target.l - .5) * .5, .03, .97);
  color.setHSL(target.h, target.s, l, THREE.SRGBColorSpace);
  data[i] = color.r * 255; data[i + 1] = color.g * 255; data[i + 2] = color.b * 255;
 }
 ctx.putImageData(pixels, 0, 0);
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = source.colorSpace;
 texture.flipY = source.flipY;
 texture.wrapS = source.wrapS; texture.wrapT = source.wrapT;
 texture.anisotropy = source.anisotropy;
 texture.needsUpdate = true;
 return texture;
}

const LAMP_NAME = /-lamp$/;
const LAMP_ON = new THREE.Color(6, .25, .2);

const wheelBox = new THREE.Box3();

/** A rim's own radius, measured across its rolling plane (the axle is local X by the standard). */
function rimRadius(node: THREE.Object3D): number {
 wheelBox.setFromObject(node);
 return Math.max(wheelBox.max.y - wheelBox.min.y, wheelBox.max.z - wheelBox.min.z) / 2;
}

/** Metres of road ahead a headlight beam is aimed at, and how far it drops over that distance. */
const HEADLIGHT_REACH = 38, HEADLIGHT_DROP = 3.2;
/** Half-angle of the beam, radians, and its power (a spot light with decay needs a big number). */
const HEADLIGHT_CONE = .5, HEADLIGHT_POWER = 460;

/** Radial cut-out for round lenses; the decal itself is always a rectangle. */
let mask: THREE.CanvasTexture | undefined;
function roundMask(): THREE.CanvasTexture {
 if (mask) return mask;
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = 64;
 const ctx = canvas.getContext('2d')!;
 const gradient = ctx.createRadialGradient(32, 32, 29, 32, 32, 32);
 gradient.addColorStop(0, '#fff');
 gradient.addColorStop(1, '#000');
 ctx.fillStyle = gradient;
 ctx.fillRect(0, 0, 64, 64);
 mask = new THREE.CanvasTexture(canvas);
 return mask;
}
const REVERSE_ON = new THREE.Color(4, 4, 3.6);

/** Static axle compression; wheel height slides relative to it. */
const REST_COMPRESSION = [REST_COMPRESSION_FRONT, REST_COMPRESSION_FRONT, REST_COMPRESSION_REAR, REST_COMPRESSION_REAR];

/** Loaded GLB model: material tweaks, wheel pivots, pose application. */
export class VehicleView {
 readonly group = new THREE.Group();
 wheels: WheelView[] = [];
 private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 private model?: THREE.Object3D;
 private wheelRest: number[] = [];
 private brakeLamps: THREE.Mesh[] = [];
 private reverseLamps: THREE.Mesh[] = [];
 /** The wish, kept here because it is usually made before the model has finished loading. */
 private headlightsOn = true;
 /** Shader handles for the body paint, and the colour last asked for. */
 private painted: PaintUniforms[] = [];
 private paint: THREE.Color | null = null;

 constructor() { this.group.visible = false; }

 get loaded(): boolean { return !!this.model; }

 /**
  * Beams from the headlight mounts down the road ahead.
  *
  * These used to be point lights sitting at the mounts, which is a lamp inside the bumper: it lit
  * the tarmac under the car and a couple of metres of it, and nothing of what the driver is about
  * to reach. A spot light aimed at a point well ahead and slightly down is what a headlight is.
  */
 private addHeadlights(model: THREE.Object3D, mounts: THREE.Object3D[]) {
  if (!mounts.length) return;
  const on = this.headlightsOn;
  // The mounts sit at an arbitrary depth in the source tree; their place on the car is what counts.
  const target = new THREE.Object3D();
  target.position.set(0, -HEADLIGHT_DROP, -HEADLIGHT_REACH);
  model.add(target);
  for (const mount of mounts) {
   const lamp = new THREE.SpotLight(0xfff4d6, HEADLIGHT_POWER, HEADLIGHT_REACH * 1.6, HEADLIGHT_CONE, .55, 1.4);
   lamp.name = 'headlight';
   lamp.visible = on;
   mount.getWorldPosition(lamp.position);
   model.worldToLocal(lamp.position);
   lamp.target = target;
   model.add(lamp);
  }
 }

 /** An empty pattern matches nothing, which turns that look rule off. */
 private pattern(source: string) { return new RegExp(source || '(?!)', 'i'); }

 async load(design: VehicleDesign): Promise<void> {
  const gltf = await this.loader.loadAsync(design.model.url);
  const model = gltf.scene;
  // Vehicle transforms are baked into the normalized GLB; runtime only sets pivot and material.
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  const strip = this.pattern(design.visual.strip), paint = this.pattern(design.visual.paint);
  const rehue = design.visual.paintHue && design.visual.tint ? new THREE.Color(design.visual.tint) : null;
  const recolored = new Map<THREE.Texture, THREE.Texture>();
  const painted: PaintUniforms[] = [];
  const wheelNodes: THREE.Object3D[] = [];
  const headlights: THREE.Object3D[] = [];
  model.traverse(node => {
   if (/^SHADOW|_(L|M|VL)$/i.test(node.name)) node.visible = false;
   if (/^(HEADLIGHT[01]|HLIGHT)_H$/i.test(node.name)) {
    // The source exports headlight planes as floating white cards; use real lights instead.
    node.visible = false;
    if (/^HEADLIGHT[01]_H$/i.test(node.name)) headlights.push(node);
   }
   const turns = /^WHL[0-3]_H$/i.test(node.name);
   if (turns) wheelNodes.push(node);
   if (node instanceof THREE.Mesh) {
    node.castShadow = true;
    node.receiveShadow = true;
    node.material = Array.isArray(node.material) ? node.material.map(material => satin(material, turns)) : satin(node.material, turns);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(material => {
     material.side = THREE.DoubleSide;
     // Blank the badge/decal layer and optionally paint the body panels.
     if (strip.test(material.name)) {
      material.map = null;
      if (/driver/i.test(material.name)) { material.transparent = true; material.opacity = 0; material.depthWrite = false; }
      else material.color.set('#23272c');
     } else if (rehue && material instanceof THREE.MeshStandardMaterial && material.map) {
      // Baked paint: re-hue the texture instead of tinting (a colour multiply only darkens).
      if (!recolored.has(material.map)) recolored.set(material.map, recolorPaint(material.map, design.visual.paintHue!, rehue));
      material.map = recolored.get(material.map)!;
     } else if (!turns && (design.visual.paintHue || design.visual.palePaint) && material instanceof THREE.MeshStandardMaterial && material.map) {
      // The swatches paint the car, never its tyres.
      const handles = paintable(material, design.visual.paintHue, !!design.visual.palePaint);
      if (handles) painted.push(handles);
     } else if (design.visual.tint && paint.test(material.name)) material.color.set(design.visual.tint);
     material.needsUpdate = true;
    });
   }
  });
  this.painted = painted;
  const wheels: WheelView[] = [], wheelRest: number[] = [];
  wheelNodes.forEach(node => {
   model.attach(node);
   const radius = rimRadius(node);
   const pivot = new THREE.Group();
   pivot.position.copy(node.position);
   wheelRest.push(node.position.y);
   model.add(pivot);
   node.position.set(0, 0, 0);
   pivot.add(node);
   wheels.push({
    wheel: node, pivot, steering: /^WHL[01]_/.test(node.name),
    spinScale: radius > 0.05 ? design.dimensions.wheelRadius / radius : 1,
    radius,
   });
  });
  this.addHeadlights(model, headlights);
  this.addLamps(model, design.visual.lamps);
  this.group.add(model);
  this.group.visible = true;
  this.disposeModel();
  this.model = model;
  this.wheels = wheels;
  this.wheelRest = wheelRest;
  if (this.paint) this.setPaint(this.paint);
 }

 /**
  * Rear brake (red, outboard) and reverse (white, inboard) lamps. `visual.lamps` gives their mounts in
  * model space (metres, measured with the viewer); without it the body box fractions are used. Each lamp
  * is projected onto the tail as a decal, so it follows the panel it lights instead of hovering in front
  * of it as a flat plate; `round` lenses are cut out of that decal with a radial mask.
  */
 private addLamps(model: THREE.Object3D, config?: LampConfig) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const fallback: LampConfig = {
   brake: { center: [size.x * .32, box.min.y + size.y * .5, box.max.z], size: [size.x * .1, size.y * .05] },
   reverse: { center: [size.x * .23, box.min.y + size.y * .5, box.max.z], size: [size.x * .06, size.y * .05] },
  };
  const sites = lampSites(config, fallback);
  const ray = new THREE.Raycaster(), aim = new THREE.Object3D(), normal = new THREE.Vector3();
  const panels = (): THREE.Mesh[] => {
   const meshes: THREE.Mesh[] = [];
   model.traverse(node => { if (node instanceof THREE.Mesh && !LAMP_NAME.test(node.name) && node.visible) meshes.push(node); });
   return meshes;
  };
  const lamp = ({ center, size: [w, h], round }: LampPlacement, color: THREE.ColorRepresentation, name: string, offset = 0) => {
   const [x, y, z] = center;
   // Find the panel under the mount and lay the lens on it, tilted with the surface it sits in.
   ray.set(new THREE.Vector3(x, y, z + 1), new THREE.Vector3(0, 0, -1));
   const hit = ray.intersectObjects(panels(), false)[0];
   const material = new THREE.MeshBasicMaterial({
    color, toneMapped: false, transparent: true, depthWrite: false,
    alphaMap: round ? roundMask() : null, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
   });
   if (!hit?.face) return null;
   normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
   // A lens has to lie on a panel that faces the road behind it. Projected onto something nearly
   // edge-on - a wing pylon, the lip of a diffuser - the decal comes back as a torn sliver hanging
   // in the air, which the outline pass then draws a line around.
   if (normal.z < .35) return null;
   aim.position.copy(hit.point).addScaledVector(normal, offset);
   aim.lookAt(hit.point.clone().add(normal));
   const geometry = new DecalGeometry(hit.object as THREE.Mesh, aim.position, aim.rotation, new THREE.Vector3(w, h, .3));
   const mesh = new THREE.Mesh(geometry, material);
   mesh.name = name;
   model.add(mesh);
   return mesh;
  };
  const kept = (list: (THREE.Mesh | null)[]) => list.filter((mesh): mesh is THREE.Mesh => !!mesh);
  this.brakeLamps = kept(sites.brake.map(site => lamp(site, LAMP_ON, 'brake-lamp')));
  // The reverse pane usually sits inside the brake cluster, so it is lifted clear of it.
  this.reverseLamps = kept(sites.reverse.map(site => lamp(site, REVERSE_ON, 'reverse-lamp', .004)));
  this.setLamps(false, false);
 }

 /**
  * Repaints the body. `null` puts the baked colour back.
  *
  * The swatch is a uniform: no texture is rebuilt, nothing is uploaded, so this is as cheap to do
  * on every frame of a colour picker as it is once. Safe before the model arrives - the wish is
  * kept and applied when it does.
  */
 setPaint(color: THREE.ColorRepresentation | null): void {
  this.paint = color === null ? null : new THREE.Color(color);
  for (const handles of this.painted) {
   handles.uPaintOn.value = this.paint ? 1 : 0;
   if (this.paint) handles.uPaint.value.copy(this.paint);
  }
 }

 /** Beams on or off. Safe before the model arrives: the wish is kept and the beams are built to it. */
 setHeadlights(on: boolean): void {
  this.headlightsOn = on;
  this.group.traverse(node => { if (node.name === 'headlight') node.visible = on; });
 }

 setLamps(brake: boolean, reverse: boolean) {
  // An unlit lamp is hidden rather than painted dark: the model already has a lens there, and a dark
  // patch over it reads as a leftover plate, especially inside a brake lens that is lit around it.
  for (const m of this.brakeLamps) m.visible = brake;
  for (const m of this.reverseLamps) m.visible = reverse;
 }

 lampPositions() {
  // Decal vertices are already in model space, so the centre comes from the geometry, not the transform.
  const at = (mesh: THREE.Mesh) => {
   const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
   return mesh.localToWorld(box.getCenter(new THREE.Vector3())).toArray().map(v => Math.round(v * 1000) / 1000);
  };
  return { brake: this.brakeLamps.map(at), reverse: this.reverseLamps.map(at) };
 }

 resetPose() { this.wheels.forEach(({ pivot }) => pivot.rotation.set(0, 0, 0)); }

 applyPose(previous: CarState, current: CarState, alpha: number) {
  const model = this.model;
  if (!model) return;
  model.rotation.x = THREE.MathUtils.lerp(previous.pitch, current.pitch, alpha);
  model.rotation.z = THREE.MathUtils.lerp(previous.roll, current.roll, alpha);
  this.wheels.forEach(({ wheel, pivot, steering }, i) => {
   const now = current.wheels[i], before = previous.wheels[i];
   if (!now) return;
   // The normalized GLB standard keeps every wheel axle on local X.
   const spin = before ? before.spin + (now.spin - before.spin) * alpha : now.spin;
   wheel.rotation.x = spin * this.wheels[i].spinScale;
   if (steering) pivot.rotation.y = -now.steer;
   // The body height carries the travel; the wheel only takes the remainder.
   pivot.position.y = this.wheelRest[i] + (now.compression - REST_COMPRESSION[i]) * SUSP_TRAVEL;
  });
 }

 private disposeModel() {
  const model = this.model;
  if (!model) return;
  this.group.remove(model);
  const textures = new Set<THREE.Texture>();
  model.traverse(node => {
   if (!(node instanceof THREE.Mesh)) return;
   node.geometry.dispose();
   for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
   }
  });
  textures.forEach(texture => texture.dispose());
 }
}
