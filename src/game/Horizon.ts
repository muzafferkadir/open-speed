// Banded horizon ring drawn behind the world: a cylinder of stacked colour bands, described
// by `3Trxx.HRZ`). The horizon is a ring of `radius` metres centred on the camera, Gouraud-shaded in
// two bands: an EARTH band from `baseHeight` up to the midpoint and a SKY band from the midpoint up
// to `baseHeight + height`. Above the ring's top and below its base it flat-fills with the
// band's end colour.
//
// The sky band's base colour is given per azimuth -- one value at the sun, one opposite it -- so the
// horizon is brightest toward the sun. Which world azimuth the bands start from is a choice here: the
// descriptor's `rotation` is the ring's own rotation, not a sun position. The ring here is therefore
// oriented to the scene sun light, which keeps the haze with the sun as the car turns.
//
// The horizon pixmap band (`pixmapBottom`..`pixmapTop`) carries the `CLD*` cloud sprites from
// SKY.FSH; those decode with the FSH reader but their layout is not extracted yet,
// so the band shows the shading ramp only.

import * as THREE from 'three';
import type { RoadHrz3 } from '../physics/RoadWorld.ts';
import { blendRgb, srgbToLinear, type Rgb } from './color.ts';

/** Elevation in degrees of a horizon height (metres) seen from the ring centre. */
export const horizonElevation = (metres: number, radius: number) =>
 (Math.atan2(metres, Math.max(1e-6, radius)) * 180) / Math.PI;

/** The horizon heights the bands are painted between, as elevations in degrees. */
export type HorizonBands = {
 base: number; midpoint: number; top: number; pixmapBottom: number; pixmapTop: number;
 sunAzimuth: number;
};

/** Ring heights -> view elevations. The sky is camera-relative, so the ring radius is the only scale. */
export function horizonBands(hrz: RoadHrz3, sunAzimuthDeg: number): HorizonBands {
 const elev = (metres: number) => horizonElevation(hrz.baseHeight + metres, hrz.radius);
 return {
  base: elev(0),
  midpoint: elev(hrz.midpoint),
  top: elev(hrz.height),
  pixmapBottom: elev(hrz.pixmapBottom),
  pixmapTop: elev(hrz.pixmapTop),
  sunAzimuth: ((sunAzimuthDeg % 360) + 360) % 360,
 };
}


/**
 * Warmth the horizon keeps from the descriptor's sun-side halo: the source is near-white at the sun
 * (255,250,250 on TR04) and painting that over the fog drew the hard cream band the reviewer saw
 * where the sky meets the sand. `tintedTo` blends most of the halo away so the band matches the fog
 * while the sun still reads a little warmer than the rest of the ring.
 */
const SUN_WARMTH = 0.22;

/** The descriptor's ring colour pulled toward the haze colour, so the ring never paints a brighter
 *  tone than the sky gradient behind it. `haze` is the same value `Stage` gives `scene.fog`. */
const tintedTo = (color: Rgb, haze: Rgb): Rgb => blendRgb(haze, color, SUN_WARMTH);

/** Gouraud blend around the ring: the sun colour at the sun, the opposite one half a turn away. */
function skyBaseColor(hrz: RoadHrz3, bands: HorizonBands, azimuthDeg: number): Rgb {
 const delta = Math.abs((((azimuthDeg - bands.sunAzimuth) % 360) + 540) % 360 - 180);
 return blendRgb(hrz.skyBaseOpposite, hrz.skyBaseSun, 1 - delta / 180);
}

/** The horizon colour at one view direction: `elevationDeg` above the ring centre, `azimuthDeg` around it. */
export function sampleHorizon(hrz: RoadHrz3, bands: HorizonBands, elevationDeg: number, azimuthDeg: number): Rgb {
 if (elevationDeg <= bands.base) return hrz.earthBase;
 if (elevationDeg <= bands.midpoint)
  return blendRgb(hrz.earthBase, hrz.earthTop, (elevationDeg - bands.base) / (bands.midpoint - bands.base));
 if (elevationDeg <= bands.top)
  return blendRgb(skyBaseColor(hrz, bands, azimuthDeg), hrz.skyTop, (elevationDeg - bands.midpoint) / (bands.top - bands.midpoint));
 return hrz.skyTop;
}

/**
 * Paint the descriptor into an equirectangular RGBA buffer (row 0 = zenith, as three.js samples a
 * flipped texture). Returns the row-major buffer so callers can hand it to `putImageData`.
 */
export function paintHorizon(hrz: RoadHrz3, sunAzimuthDeg: number, width: number, height: number): Uint8ClampedArray {
 const bands = horizonBands(hrz, sunAzimuthDeg);
 const out = new Uint8ClampedArray(width * height * 4);
 for (let y = 0; y < height; y++) {
  // three.js equirect UV: v = elevation / 180 + 0.5, and the canvas top row is v = 1.
  const v = 1 - (y + 0.5) / height;
  const elevation = (v - 0.5) * 180;
  for (let x = 0; x < width; x++) {
   const c = sampleHorizon(hrz, bands, elevation, (x / width) * 360 - 180);
   const i = (y * width + x) * 4;
   out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
 }
 return out;
}

/** Metres of ring height the earth/sky seam is split over, so the two bands keep their own colour. */
export const SEAM = 2;

/** Equirect azimuth of a direction: the same `atan2(z, x)` three.js uses for the background. */
export const azimuthOf = (x: number, z: number) => (Math.atan2(z, x) * 180) / Math.PI;

/**
 * The horizon ring as world geometry: `radialSegments` columns, one row per band edge, vertex
 * coloured by world azimuth (`atan2(z, x)`). Add it to the scene and copy the car position onto it
 * each frame -- the ring is camera-relative, so it has to follow the camera in X/Y/Z.
 *
 * `topColor` is the sky band's colour at the ring's top edge: `Stage` passes the same fog colour it
 * hands `scene.fog`, so the ring's far edge lands on the haze and the visible band disappears into
 * the sky gradient's own horizon colour (the seam the reviewer flagged as a hard cream line).
 */
export function horizonMesh(hrz: RoadHrz3, sunAzimuthDeg: number, haze?: Rgb, radialSegments = 180): THREE.Mesh {
 const bands = horizonBands(hrz, sunAzimuthDeg);
 const blend = (c: Rgb) => (haze ? tintedTo(c, haze) : c);
 const rowOf = [
  { y: hrz.baseHeight, color: () => hrz.earthBase as Rgb },
  // The earth band's top edge and the sky band's base edge both pull toward the haze: the source's
  // sun-side sky base is near-white (255,250,250 on TR04) and painting that at the horizon is the
  // bright band the reviewer saw. Only a touch of the warmth survives, so the sun still reads warmer.
  { y: hrz.baseHeight + hrz.midpoint - SEAM, color: () => blend(hrz.earthTop) },
  { y: hrz.baseHeight + hrz.midpoint + SEAM, color: (phi: number) => blend(skyBaseColor(hrz, bands, phi)) },
  { y: hrz.baseHeight + hrz.height, color: () => haze ?? hrz.skyTop },
 ];
 const cols = radialSegments + 1; // seam column repeats the first so the azimuth blend closes
 const position = new Float32Array(rowOf.length * cols * 3);
 const color = new Float32Array(rowOf.length * cols * 3);
 const index: number[] = [];
 for (let r = 0; r < rowOf.length; r++) {
  for (let c = 0; c < cols; c++) {
   const phi = ((c % radialSegments) / radialSegments) * 360;
   const rad = (phi * Math.PI) / 180;
   const t = (r * cols + c) * 3;
   position[t] = Math.cos(rad) * hrz.radius;
   position[t + 1] = rowOf[r].y;
   position[t + 2] = Math.sin(rad) * hrz.radius;
   const rgb = rowOf[r].color(phi);
   // Vertex colours are sampled as linear; the descriptor's bytes are sRGB. Writing them raw made
   // the ring roughly twice as bright as the sRGB sky texture behind it -- the hard bright band the
   // reviewer saw at the horizon. Convert once per vertex so the ring matches the fog exactly.
   const srgb = srgbToLinear(rgb);
   color[t] = srgb[0]; color[t + 1] = srgb[1]; color[t + 2] = srgb[2];
  }
 }
 for (let r = 0; r < rowOf.length - 1; r++)
  for (let c = 0; c < radialSegments; c++) {
   const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
   index.push(a, d, b, b, d, e);
  }
 const geometry = new THREE.BufferGeometry();
 geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
 geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
 geometry.setIndex(index);
 const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
 }));
 mesh.name = 'horizon';
 mesh.renderOrder = -1;
 mesh.frustumCulled = false;
 return mesh;
}
