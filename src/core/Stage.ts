import * as THREE from 'three';
import { isOval, isRoad, type GameMap } from '../track/maps.js';
import { expDensity, FOG_DEPTH, fogRange, hazeAt } from '../game/DepthCue.ts';
import { horizonMesh } from '../game/Horizon.ts';
import { makeSky, rgbCss, skyHorizonColor, SUN_AZIMUTH, SUN_OFFSET } from '../game/Sky.ts';

export type Stage = { scene: THREE.Scene; sun: THREE.DirectionalLight; horizon?: THREE.Mesh };

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
 // The drive renders through the composer, whose own target carries the multisampling, so the
 // context's antialias buffer would only be allocated and never looked at.
 const renderer = new THREE.WebGLRenderer({ canvas });
 renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
 renderer.shadowMap.enabled = true;
 renderer.shadowMap.type = THREE.PCFSoftShadowMap;
 // Every texture the game loads is seen at a grazing angle - the road ahead, the verge, the
 // terrain - and at anisotropy 1 those are smeared into mush a few metres past the car. Setting
 // the default once here covers the textures the GLTF loader makes as well.
 THREE.Texture.DEFAULT_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
 applyTone(renderer, DEFAULT_TONE);
 return renderer;
}

/**
 * How the renderer gets from the light it computed to the pixels a screen can show.
 *
 * It is the one setting that changes every frame at once, and the three worth having differ in
 * what they do with a blown highlight: ACES rolls it off warm, AgX holds its hue much further up
 * and desaturates instead of clipping, Neutral is the flattest of the three. Each carries the
 * exposure that keeps the same scene at the same brightness, so switching does not also change
 * how bright the game is.
 */
export const TONES = ['aces', 'agx', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

const TONE_SETTINGS: Record<Tone, { mapping: THREE.ToneMapping; exposure: number }> = {
 aces: { mapping: THREE.ACESFilmicToneMapping, exposure: 0.98 },
 agx: { mapping: THREE.AgXToneMapping, exposure: 1.45 },
 neutral: { mapping: THREE.NeutralToneMapping, exposure: 1.05 },
};

export const DEFAULT_TONE: Tone = 'aces';

export function applyTone(renderer: THREE.WebGLRenderer, tone: Tone): void {
 const setting = TONE_SETTINGS[tone] ?? TONE_SETTINGS[DEFAULT_TONE];
 renderer.toneMapping = setting.mapping;
 renderer.toneMappingExposure = setting.exposure;
}

export function createStage(renderer: THREE.WebGLRenderer, map: GameMap): Stage {
 const scene = new THREE.Scene();
 const road = isRoad(map) ? map : null;
 const theme = isOval(map) ? 'desert' : road?.sky3 || road?.sky ? 'resort' : 'coastal';
 const sky = makeSky(theme, road?.sky, road?.sky3);
 scene.background = sky;
 const pmrem = new THREE.PMREMGenerator(renderer);
 scene.environment = pmrem.fromEquirectangular(sky).texture;
 pmrem.dispose();
 scene.fog = createFog(map);
 // Sky/ground bounce. It is the only light the canyon walls and the tunnel get once the sun is
 // blocked, so it carries the shaded half of the track: at 1.2 with a near-black ground tone the
 // canyon section read as night. The ground tone is lifted to warm sand, which is what actually
 // bounces back up on this map.
 scene.add(new THREE.HemisphereLight('#dff0ff', '#9b8f6d', 1.75));
 // Floor light. The tunnel and the cave have no sky above them at all, so even the bounce light
 // misses their ceilings and they render pure black; against the sun and the bounce this is a few
 // percent outdoors but it is the whole of the light inside.
 scene.add(new THREE.AmbientLight('#cfd8e0', 0.45));
 const sun = createSun();
 scene.add(sun, sun.target);
 // The ring paints the descriptor's horizon bands; its top edge gets the same haze colour the fog
 // carries so the band fades into the sky at elevation 0 instead of drawing a hard bright line.
 const hrz3 = road?.sky3;
 const horizon = hrz3 ? horizonMesh(hrz3, SUN_AZIMUTH, skyHorizonColor(hrz3.skyTop, hrz3.earthBase)) : undefined;
 if (horizon) scene.add(horizon);
 return { scene, sun, horizon };
}

export function followSun(sun: THREE.DirectionalLight, target: THREE.Vector3) {
 sun.position.copy(target).add(SUN_OFFSET);
 sun.target.position.copy(target);
}

/** Shadow map resolution, and how far from the car the shadow box reaches, in metres. */
const SHADOW_TEXELS = 2048, SHADOW_REACH = 70;

/** Fog colours for a map that ships no horizon descriptor: the desert ring and the coastal haze. */
const DESERT_HAZE = '#dcd3c0';
const COASTAL_HAZE = '#d6e4ec';

/** Fallback densities (1/m) for the maps with no depth cue, tuned so the far plane still hazes. */
const DESERT_DENSITY = 0.0009;
const ROAD_DENSITY = 0.0016;
// The island is a clear coastal day, not a fog bank: at 0.0026 the town washed out to the haze
// tone within a couple of hundred metres and its buildings read as pale blocks on a lawn.
const CITY_DENSITY = 0.0011;

/** Least haze a depth cue applies, so an over-clear descriptor cannot leave the fog invisible. */
const MIN_DEPTH = 0.05;

function createFog(map: GameMap): THREE.FogExp2 {
 if (isRoad(map) && map.sky3) {
  // The horizon band sits on the sky's horizon colour, so the fog has to carry that colour too:
  // otherwise distant terrain fades into a fog tone the horizon never paints and a seam appears.
  const far = map.sky?.depthCues?.at(-1) ?? fogRange(map.light)[1];
  const haze = rgbCss(skyHorizonColor(map.sky3.skyTop, map.sky3.earthBase));
  return new THREE.FogExp2(haze, expDensity(far, FOG_DEPTH));
 }
 if (isRoad(map) && map.light) {
  const [, far] = fogRange(map.light);
  const haze = map.sky ? rgbCss(map.sky.horizonBase) : COASTAL_HAZE;
  return new THREE.FogExp2(haze, expDensity(far, Math.max(hazeAt(map.light, far), MIN_DEPTH)));
 }
 if (isOval(map)) return new THREE.FogExp2(DESERT_HAZE, DESERT_DENSITY);
 return new THREE.FogExp2(COASTAL_HAZE, isRoad(map) ? ROAD_DENSITY : CITY_DENSITY);
}

function createSun(): THREE.DirectionalLight {
 const sun = new THREE.DirectionalLight('#fff4d8', 3.6);
 sun.position.copy(SUN_OFFSET);
 sun.castShadow = true;
 sun.shadow.mapSize.set(SHADOW_TEXELS, SHADOW_TEXELS);
 // A tighter box around the car is worth more than a bigger map: at 200 m across, 2048 texels
 // gave a 10 cm shadow pixel and every edge was a staircase.
 Object.assign(sun.shadow.camera, { left: -SHADOW_REACH, right: SHADOW_REACH, top: SHADOW_REACH, bottom: -SHADOW_REACH, far: 400 });
 sun.shadow.normalBias = 0.05;
 sun.shadow.bias = -0.0004;
 return sun;
}
