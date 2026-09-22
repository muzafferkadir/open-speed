import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/** Late-90s arcade-racer grade (late-90s arcade racers vibe): radial speed blur, punchy saturation
 *  and contrast, a warm-highlight / cool-shadow split, a soft vignette and faint
 *  film grain. Runs in display space, after tone mapping (OutputPass).
 *
 *  The values are the ones picked on screen with the `?tune` panel, which is the only way to
 *  choose them: punchy colour, a heavy vignette and grain, a soft wide bloom, light occlusion. */
/** How close a pixel's colour has to be to the haze before the grade stops pushing it. */
const HAZE_REACH = 0.45;

const GradeShader = {
 uniforms: {
  tDiffuse: { value: null as THREE.Texture | null },
  uTime: { value: 0 },
  uSpeed: { value: 0 },        // 0-1, drives the radial blur
  uSaturation: { value: 1.87 },
  uContrast: { value: 1.11 },
  uVignette: { value: 1 },
  uGrain: { value: 0.15 },
  /** Pixels of red/blue split at the very corner of the frame. */
  uFringe: { value: 4.4 },
  /** The haze the scene's fog fades into; the grade leaves anything near it alone. */
  uHaze: { value: new THREE.Color('#d6e4ec') },
  /** Which look the grade wears; see LOOKS. */
  uLook: { value: 0 },
  /** One pixel, for the looks that need to read their neighbours. */
  uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
 },
 vertexShader: /* glsl */`
  varying vec2 vUv;
  void main() {
   vUv = uv;
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`,
 fragmentShader: /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uTime, uSpeed, uSaturation, uContrast, uVignette, uGrain, uFringe;
  uniform vec3 uHaze;
  uniform int uLook;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
   vec2 dir = vUv - 0.5;
   vec3 col = texture2D(tDiffuse, vUv).rgb;

   // radial speed blur — stronger toward the frame edges and with speed
   float amt = clamp(uSpeed, 0.0, 1.0);
   if (amt > 0.001) {
    vec3 acc = col;
    for (int i = 1; i <= 10; i++) {
     float t = float(i) / 10.0;
     acc += texture2D(tDiffuse, vUv - dir * t * 0.16 * amt).rgb;
    }
    acc /= 11.0;
    col = mix(col, acc, smoothstep(0.0, 0.42, length(dir)) * amt);
   }

   // Chromatic aberration: a lens splits the colours it bends, and it bends most at the edge.
   // Kept to well under a pixel in the middle, so it reads as glass rather than as a fault.
   float edge = dot(dir, dir);
   vec2 fringe = dir * uTexel * uFringe * edge;
   col = vec3(texture2D(tDiffuse, vUv + fringe).r, col.g, texture2D(tDiffuse, vUv - fringe).b);

   // contrast around mid-grey
   col = (col - 0.5) * uContrast + 0.5;
   // Saturation, but not at the expense of the distance.
   //
   // Aerial perspective is what tells the eye how far away something is: the fog drains the colour
   // out of the horizon, and a flat saturation boost puts every bit of it straight back, so the
   // far treeline came out as vivid as the verge. There is no depth buffer here, but the fog has
   // already written distance into the colour - a pixel sitting on the haze tone is a far one - so
   // the boost is eased off as a pixel approaches it.
   float luma = dot(col, vec3(0.299, 0.587, 0.114));
   float hazed = 1.0 - smoothstep(0.0, ${HAZE_REACH.toFixed(2)}, distance(col, uHaze));
   col = mix(vec3(luma), col, mix(uSaturation, 1.0, hazed));
   // split-tone: warm highlights, cool shadows
   vec3 warm = vec3(1.07, 1.02, 0.90);
   vec3 cool = vec3(0.93, 0.98, 1.08);
   col *= mix(cool, warm, smoothstep(0.15, 0.85, luma));
   // vignette
   float vig = 1.0 - smoothstep(0.28, 0.92, length(dir));
   col *= mix(1.0, vig, uVignette);
   // faint animated grain
   float g = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
   col += (g - 0.5) * uGrain;

   // The looks. Everything above is the house grade; each of these is a whole style laid over it,
   // and they are all display-space, which is why they can be this cheap.
   if (uLook == 1) {
    // Hyper-casual: flat, loud colour with a drawn outline. Posterising the value and pushing
    // the saturation is most of the toy look; the outline is what makes it read as drawn.
    vec3 lift = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.9);
    col = floor(clamp(lift, 0.0, 1.0) * 5.0 + 0.5) / 5.0;
    float l0 = dot(texture2D(tDiffuse, vUv).rgb, vec3(0.299, 0.587, 0.114));
    float lx = dot(texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float ly = dot(texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, vec3(0.299, 0.587, 0.114));
    col *= 1.0 - smoothstep(0.06, 0.16, length(vec2(lx - l0, ly - l0)));
   } else if (uLook == 2) {
    // Aged film: sepia, heavy grain, a dirty vignette and a slow flicker in the exposure.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, 0.22) * vec3(1.14, 0.98, 0.78);
    col *= 0.94 + 0.06 * sin(uTime * 11.0) + 0.04 * sin(uTime * 37.0);
    float dust = step(0.9995, fract(sin(dot(floor(vUv * 620.0) + floor(uTime * 16.0), vec2(41.3, 289.1))) * 9137.0));
    col = mix(col, vec3(0.95, 0.92, 0.84), dust * 0.7);
    col += (g - 0.5) * 0.16;
    col *= 1.0 - smoothstep(0.25, 0.95, length(dir)) * 0.55;
   } else if (uLook == 3) {
    // CRT: scanlines, a shadow-mask tint per column, and the chroma pulled apart a little.
    float shift = uTexel.x * 1.6;
    col = vec3(texture2D(tDiffuse, vUv + vec2(shift, 0.0)).r, col.g, texture2D(tDiffuse, vUv - vec2(shift, 0.0)).b);
    float line = 0.82 + 0.18 * sin(vUv.y / uTexel.y * 3.14159);
    vec3 mask = vec3(1.04, 0.97, 1.02);
    if (mod(floor(vUv.x / uTexel.x), 3.0) < 1.0) mask = vec3(1.1, 0.94, 0.94);
    else if (mod(floor(vUv.x / uTexel.x), 3.0) < 2.0) mask = vec3(0.94, 1.1, 0.94);
    col *= line * mask;
   } else if (uLook == 4) {
    // Comic: the value knocked down to four steps and the darkest of them hatched.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.5);
    col = floor(clamp(col, 0.0, 1.0) * 4.0 + 0.5) / 4.0;
    vec2 px = vUv / uTexel;
    float hatch = sin((px.x + px.y) * 0.55);
    if (luma < 0.42) col *= 0.55 + 0.45 * step(0.0, hatch);
    if (luma < 0.2) col *= 0.55 + 0.45 * step(0.0, sin((px.x - px.y) * 0.55));
   } else if (uLook == 5) {
    // Noir: no colour, hard contrast, a printed grain and a heavy corner falloff.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    luma = clamp((luma - 0.5) * 1.5 + 0.48, 0.0, 1.0);
    col = vec3(luma) + (g - 0.5) * 0.1;
    col *= 1.0 - smoothstep(0.2, 0.95, length(dir)) * 0.7;
   }

   gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`,
};

/** Kills NaN/Inf before bloom: one bad HDR pixel otherwise smears into black blocks. */
const SanitizeShader = {
 uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
 vertexShader: /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
 fragmentShader: /* glsl */`
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
   vec4 c = texture2D(tDiffuse, vUv);
   if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
   gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), 1.0);
  }`,
};

/**
 * Ambient occlusion that does not eat the foliage.
 *
 * GTAO reads the scene through one override material to get its depths and normals, and an
 * override material has no per-material alpha test. Every cut-out card - and this track is built
 * from them - therefore arrives as a solid quad, so a palm occludes like a wall and the jungle
 * comes out as black blocks. They are hidden for the length of that prepass, which costs a flag
 * per card and gives up only the occlusion a leaf would have cast on itself.
 */
class FoliageSafeGTAO extends GTAOPass {
 cutouts: THREE.Object3D[] = [];
 /** What each cut-out was doing before the prepass; restoring a blanket `true` lit every lamp. */
 private readonly shown: boolean[] = [];

 render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
  this.shown.length = 0;
  for (const node of this.cutouts) { this.shown.push(node.visible); node.visible = false; }
  try { super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); }
  finally { this.cutouts.forEach((node, i) => { node.visible = this.shown[i]; }); }
 }
}

/** A material that is mostly holes: it must not act as a wall in the occlusion prepass. */
const isCutout = (material: THREE.Material): boolean =>
 material.transparent || (material as THREE.MeshStandardMaterial).alphaTest > 0;

/**
 * The styles the grade can wear, in the order the shader switches on. `remaster` is the house
 * grade on its own; the rest are whole looks laid over it.
 */
export const LOOKS = ['remaster', 'hyper', 'film', 'crt', 'comic', 'noir'] as const;
export type Look = (typeof LOOKS)[number];

/** How far a surface looks for what shades it, how hard that reads, and how many rays it takes. */
const AO_RADIUS = 1.5, AO_STRENGTH = 1.12, AO_SAMPLES = 8, AO_BLEND = 0.17;

/** Post-processing stack for the driving scene only (the garage renders direct). */
export class Postprocessing {
 private readonly composer: EffectComposer;
 private readonly grade: ShaderPass;
 private readonly ao: FoliageSafeGTAO;
 private readonly bloom: UnrealBloomPass;
 private aoRadius = AO_RADIUS;
 private aoScale = AO_STRENGTH;

 constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const size = renderer.getSize(new THREE.Vector2());
  // Multisampling a half-float target is expensive, and on a high-density display there is little
  // left to see: the pixels are already smaller than the edges it would smooth. It is kept for the
  // displays that actually need it.
  const samples = renderer.getPixelRatio() > 1.4 ? 0 : 4;
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  this.composer = new EffectComposer(renderer, target);
  this.composer.setPixelRatio(renderer.getPixelRatio());

  this.composer.addPass(new RenderPass(scene, camera));
  // Ambient occlusion: the contact darkening that puts an object on the ground rather than in
  // front of it. It is the one effect a before-and-after actually turns on.
  this.ao = new FoliageSafeGTAO(scene, camera, size.x, size.y);
  this.ao.updateGtaoMaterial({ radius: AO_RADIUS, distanceExponent: 1.4, thickness: 1, scale: AO_STRENGTH, samples: AO_SAMPLES });
  this.ao.blendIntensity = AO_BLEND;
  this.composer.addPass(this.ao);
  this.composer.addPass(new ShaderPass(SanitizeShader));
  // strength, radius, threshold — softer + higher threshold so bright spots glow
  // instead of clipping into big white/cyan orbs
  // Soft and wide rather than bright: a low strength over a big radius with a threshold above 1,
  // so only what is actually blown out blooms.
  this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.21, 1.26, 1.07);
  this.composer.addPass(this.bloom);
  this.composer.addPass(new OutputPass()); // tone mapping + sRGB
  this.grade = new ShaderPass(GradeShader);
  this.composer.addPass(this.grade);
 }

 setSize(width: number, height: number) {
  this.composer.setSize(width, height);
  this.grade.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
 }

 /**
  * Turns the whole stack off, leaving the bare render. The point is the comparison: what the
  * effects are worth is only ever obvious next to the frame without them.
  */
 setEnabled(on: boolean): void {
  this.ao.enabled = on;
  this.bloom.enabled = on;
  this.grade.enabled = on;
 }

 /** Every knob the tuning panel can reach, with what it is set to now. */
 readings(): Record<string, number> {
  const u = this.grade.uniforms;
  return {
   saturation: u.uSaturation.value, contrast: u.uContrast.value, vignette: u.uVignette.value,
   grain: u.uGrain.value, fringe: u.uFringe.value,
   bloom: this.bloom.strength, bloomRadius: this.bloom.radius, bloomThreshold: this.bloom.threshold,
   ao: this.ao.blendIntensity, aoRadius: this.aoRadius, aoScale: this.aoScale,
  };
 }

 /** Sets one of {@link readings}. Unknown names are ignored, so a stale panel cannot throw. */
 tune(key: string, value: number): void {
  const u = this.grade.uniforms;
  switch (key) {
   case 'saturation': u.uSaturation.value = value; break;
   case 'contrast': u.uContrast.value = value; break;
   case 'vignette': u.uVignette.value = value; break;
   case 'grain': u.uGrain.value = value; break;
   case 'fringe': u.uFringe.value = value; break;
   case 'bloom': this.bloom.strength = value; break;
   case 'bloomRadius': this.bloom.radius = value; break;
   case 'bloomThreshold': this.bloom.threshold = value; break;
   case 'ao': this.ao.blendIntensity = value; break;
   case 'aoRadius': this.aoRadius = value; this.updateAo(); break;
   case 'aoScale': this.aoScale = value; this.updateAo(); break;
  }
 }

 private updateAo(): void {
  this.ao.updateGtaoMaterial({ radius: this.aoRadius, distanceExponent: 1.4, thickness: 1, scale: this.aoScale, samples: AO_SAMPLES });
 }

 /** Tells the occlusion pass which meshes are cut-outs, so it can stand them down while it reads
  *  the scene's depths. Call it whenever the scene's contents change. */
 setCutouts(scene: THREE.Object3D): void {
  const cutouts: THREE.Object3D[] = [];
  scene.traverse(node => {
   const mesh = node as THREE.Mesh;
   if (!mesh.isMesh || !mesh.material) return;
   const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
   if (materials.some(isCutout)) cutouts.push(mesh);
  });
  this.ao.cutouts = cutouts;
 }

 /** Wears one of {@link LOOKS}. An unknown name falls back to the house grade. */
 setLook(name: string): void {
  this.grade.uniforms.uLook.value = Math.max(0, LOOKS.indexOf(name as Look));
 }

 /** The tone the scene's fog fades into, so the grade can leave the distance alone. */
 setHaze(colour: THREE.Color): void {
  this.grade.uniforms.uHaze.value.copy(colour);
 }

 /** Follows the renderer when the adaptive scale changes the resolution. */
 setPixelRatio(ratio: number) {
  this.composer.setPixelRatio(ratio);
 }

 render(dt: number, speed: number) {
  const u = this.grade.uniforms;
  u.uTime.value = (u.uTime.value + dt) % 1000;
  // ease the blur so it does not pop on/off
  u.uSpeed.value += (Math.min(speed, 1) * 0.42 - u.uSpeed.value) * Math.min(dt * 10, 1);
  this.composer.render();
 }
}
