import * as THREE from 'three';
import type { RoadHrz3 } from '../physics/RoadWorld.ts';
import { blendRgb, type Rgb } from './color.ts';
import { azimuthOf, horizonBands, paintHorizon } from './Horizon.ts';

export type SkyTheme = 'coastal' | 'desert' | 'resort';
export type HrzSky = { sky: Rgb; horizonBase: Rgb };

export const SUN_OFFSET = new THREE.Vector3(-150, 80, -70);
export const SUN_AZIMUTH = azimuthOf(SUN_OFFSET.x, SUN_OFFSET.z);

export const rgbCss = (c: Rgb) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/**
 * Warm light an extra horizon stop when the descriptor's zenith and base already share a colour:
 * simply mixing two copies of one colour would leave the sky flat (TR04's `sky3` does exactly that).
 */
const HORIZON_LIFT: Rgb = [30, 22, -4];

const CHANNEL_SPREAD = 16;

/** Zenith darkening: the ramp starts from the descriptor colour pulled toward a deeper blue. */
const ZENITH_DEPTH: Rgb = [0.66, 0.62, 0.86];

/** A ramp between two equal colours is flat; lift the horizon base in that case (TR04's `sky3`). */
const baseOf = (top: Rgb, horizon: Rgb): Rgb => {
 const spread = Math.max(...top.map((c, i) => Math.abs(c - horizon[i])));
 return spread > CHANNEL_SPREAD ? horizon : [
 horizon[0] + HORIZON_LIFT[0], horizon[1] + HORIZON_LIFT[1], horizon[2] + HORIZON_LIFT[2]];
};

/**
 * The colour the sky meets the horizon with. `Stage`'s fog uses the same value, so distant
 * terrain fades into exactly the sky's own horizon colour and the two never show a seam.
 *
 * The ramp is driven by elevation rather than canvas fraction so the few degrees the driver
 * actually sees carry most of the change: `skyColorAtElevation` is the falloff, `skyGradient`
 * maps it onto the equirect canvas.
 */
export const skyHorizonColor = (top: Rgb, horizon: Rgb): Rgb => baseOf(top, horizon);

/** Zenith end: the descriptor colour pulled toward a deeper blue. */
export const skyZenithColor = (top: Rgb): Rgb => top.map((c, i) => c * ZENITH_DEPTH[i]) as Rgb;

/** The sky colour `elevationDeg` above the horizon: the zenith deep blue at 90, the band at 0. */
export function skyColorAtElevation(top: Rgb, horizon: Rgb, elevationDeg: number): Rgb {
 const e = Math.min(Math.max(elevationDeg, 0), 90);
 return blendRgb(skyZenithColor(top), skyHorizonColor(top, horizon), 1 - Math.pow(e / 90, 0.55));
}

/** three.js puts the equirect horizon at v = 0.5, so at half canvas height. */
const HORIZON_AT = 0.5;

/** The elevations the sky ramp is sampled at, zenith down to the horizon. */
const SKY_ELEVATIONS = [90, 55, 30, 16, 8, 3, 0];

/** Equirect canvas fraction of an elevation above the horizon (row 0 = zenith). */
export const canvasAt = (elevationDeg: number) => 1 - (0.5 + elevationDeg / 180);

/**
 * The sky ramp as canvas stops, ordered from the zenith (0) down to the nadir (1): t = 0.5 is the
 * horizon. The ramp reaches the horizon band colour exactly at the horizon and holds it below, so
 * the earth band keeps its own shading and the fog matches what the sky paints at the horizon.
 */
function skyGradient(top: Rgb, horizon: Rgb): [number, Rgb][] {
 // One stop per elevation, darkest first: canvasAt(90) = 0 at the zenith, canvasAt(0) = 0.5 at the
 // horizon. Below the horizon the ramp holds the band colour so the earth band is not washed out.
 const sky = SKY_ELEVATIONS.map(e => [canvasAt(e), skyColorAtElevation(top, horizon, e)] as [number, Rgb]);
 const band = skyHorizonColor(top, horizon);
 sky.push([HORIZON_AT + 0.12, band], [1, band]);
 return sky;
}

/**
 * Sun glow painted over the sky dome: a warm halo around the sun's azimuth, sitting just above
 * the horizon so the zenith keeps the descriptor's own colour.
 */
const SUN_GLOW = {
 rgb: [255, 236, 196] as Rgb,
 azimuthDeg: SUN_AZIMUTH,
 elevationDeg: 20,
 radius: 0.28,
 strength: 0.34,
};

const WIDTH = 2048;
const HEIGHT = 1024;

type Ctx = CanvasRenderingContext2D;

export function makeSky(theme: SkyTheme = 'coastal', hrz?: HrzSky | null, hrz3?: RoadHrz3 | null): THREE.CanvasTexture {
 const canvas = document.createElement('canvas');
 canvas.width = WIDTH;
 canvas.height = HEIGHT;
 const ctx = canvas.getContext('2d')!;
 const paint = () => {
  if (hrz3) paintSource(ctx, hrz3);
  else if (theme === 'resort' && hrz) paintGradient(ctx, [[0, rgbCss(hrz.sky)], [0.72, rgbCss(hrz.horizonBase)], [1, rgbCss(hrz.horizonBase)]]);
  else if (theme === 'desert') paintDesert(ctx);
  else paintCoastal(ctx);
  if (!hrz3) paintSunGlow(ctx);
  if (!hrz3 && theme === 'resort' && hrz) paintClouds(ctx, false);
 };
 paint();
 const texture = toTexture(canvas);
 // The photograph arrives after the first frame is already on screen, so the sky is painted twice:
 // once with the drawn stand-in, once with the picture. Nothing waits for it.
 if (hrz3 && !backdrop) loadBackdrop().then(() => { if (backdrop) { paint(); texture.needsUpdate = true; } });
 return texture;
}

function toTexture(canvas: HTMLCanvasElement) {
 const texture = new THREE.CanvasTexture(canvas);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.mapping = THREE.EquirectangularReflectionMapping;
 return texture;
}

/**
 * Sky: the descriptor's horizon bands (`paintHorizon`) with the graded sky ramp over
 * the upper half, so the sky gets a zenith-to-horizon falloff while the earth band below the
 * horizon keeps its own shading. The ramp reaches the horizon band's colour exactly at the
 * horizon row, which is also the fog colour: the two meet without a seam.
 */
function paintSource(ctx: Ctx, hrz3: RoadHrz3) {
 const bands = horizonBands(hrz3, SUN_AZIMUTH);
 const rows = HEIGHT >> 1;
 const image = ctx.createImageData(WIDTH, HEIGHT);
 image.data.set(paintHorizon(hrz3, bands.sunAzimuth, WIDTH, HEIGHT));
 ctx.putImageData(image, 0, 0);
 paintGradient(ctx, skyGradient(hrz3.skyTop, hrz3.earthBase).map(([at, c]) => [at, rgbCss(c)] as [number, string]));
 const earth = ctx.createImageData(WIDTH, rows);
 earth.data.set(image.data.subarray(rows * WIDTH * 4));
 ctx.putImageData(earth, 0, rows);
 paintDistance(ctx, skyHorizonColor(hrz3.skyTop, hrz3.earthBase));
 paintSunGlow(ctx);
}

/** Distant land, as elevation above the horizon and how much of the haze each layer has taken. */
const RIDGES: [number, number][] = [[0.030, 0.40], [0.020, 0.58], [0.012, 0.74]];
/** The colour distant land would be with no air in front of it. */
const FAR_LAND: Rgb = [58, 84, 92];
/** Share of the canvas the photographed horizon covers, bottom on the horizon line: about 20 deg. */
const BACKDROP_RISE = 0.125;
/** How much of the map's own haze is laid over the photograph, so it belongs to this sky. */
const BACKDROP_HAZE = 0.10;

/**
 * The photographed horizon: layered ranges, islands and a real cloud bank, drawn so its water line
 * lands on the sky's own. It is cropped to that line, cross-faded end to end so it meets itself
 * where it wraps, and faded out top and bottom, which is what lets one photograph sit in a sky
 * whose colour is a different map's.
 *
 * Built from `<source>/sky/coastal-pano.png`: crop to the water line, blend the tail into the head,
 * ramp the alpha, resize to 2048 x 170.
 */
let backdrop: HTMLImageElement | null = null;
let backdropLoad: Promise<void> | null = null;

function loadBackdrop(): Promise<void> {
 if (backdropLoad) return backdropLoad;
 const image = new Image();
 backdropLoad = new Promise<void>(done => {
  image.onload = () => { backdrop = image; done(); };
  image.onerror = () => done();
 });
 image.src = '/sky/horizon-coastal.webp';
 return backdropLoad;
}

/**
 * What is out there at the edge of the world.
 *
 * The descriptor reserves a band at the horizon for scenery and ships none, so the ring was a
 * colour ramp and the far distance was empty in every direction - which reads, at speed, as
 * driving inside a dome rather than across a place. The photograph goes in that band, under a
 * wash of the map's own haze so it is the same air as everything in front of it. Until it has
 * loaded, three lines of drawn headland stand in, each further one holding more of the haze.
 */
function paintDistance(ctx: Ctx, haze: Rgb) {
 const horizon = HEIGHT * 0.5;
 if (backdrop) {
  const rise = HEIGHT * BACKDROP_RISE;
  ctx.drawImage(backdrop, 0, horizon + 2 - rise, WIDTH, rise);
  const wash = ctx.createLinearGradient(0, horizon + 2 - rise, 0, horizon + 2);
  wash.addColorStop(0, `rgba(${rgbCss(haze).slice(4, -1)},${BACKDROP_HAZE * 0.45})`);
  wash.addColorStop(1, `rgba(${rgbCss(haze).slice(4, -1)},${BACKDROP_HAZE})`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, horizon + 2 - rise, WIDTH, rise);
  return;
 }
 RIDGES.forEach(([height, veil], layer) => {
  const seed = layer * 2.4, seed2 = layer * 5.1 + 1.3, k = 3 + layer * 2;
  ctx.fillStyle = rgbCss(blendRgb(FAR_LAND, haze, veil));
  ctx.beginPath();
  ctx.moveTo(0, horizon + 2);
  for (let x = 0; x <= WIDTH; x += 4) {
   const t = (x / WIDTH) * Math.PI * 2;
   // Harmonics of a whole turn: the last column lands on the first, so there is no seam to hide.
   let y = 0.5 + 0.5 * Math.sin(t * k + seed);
   y *= 0.55 + 0.45 * Math.sin(t * (k * 2 + 1) + seed2);
   y += 0.18 * Math.abs(Math.sin(t * (k * 3 + 2) + seed));
   ctx.lineTo(x, horizon + 2 - Math.max(0, y) * HEIGHT * height);
  }
  ctx.lineTo(WIDTH, horizon + 2);
  ctx.closePath();
  ctx.fill();
 });
 paintCloudShelf(ctx, haze);
}

function paintCloudShelf(ctx: Ctx, haze: Rgb) {
 const lit = blendRgb([255, 255, 255], haze, 0.28);
 const shade = blendRgb([196, 208, 222], haze, 0.5);
 // Wide and shallow, and enough of them to run into one another: a distant cloud bank is a shelf,
 // not a row of balls.
 for (let i = 0; i < 52; i++) {
  const at = (i + Math.random() * 0.9) / 52;
  const cx = at * WIDTH;
  const cy = HEIGHT * (0.462 + Math.random() * 0.022);
  const scale = 0.7 + Math.random() * 0.9;
  for (let puff = 0; puff < 7; puff++) {
   const px = cx + (Math.random() - 0.5) * 120 * scale;
   const py = cy + (Math.random() - 0.5) * 7 * scale;
   const pr = (11 + Math.random() * 12) * scale;
   const g = ctx.createRadialGradient(px, py - pr * 0.3, pr * 0.1, px, py, pr);
   g.addColorStop(0, `${rgbCss(lit)}`);
   g.addColorStop(0.7, rgbCss(blendRgb(shade, haze, 0.35)));
   g.addColorStop(1, rgbCss(haze));
   ctx.globalAlpha = 0.34 + Math.random() * 0.24;
   ctx.fillStyle = g;
   ctx.beginPath();
   ctx.arc(px, py, pr, 0, Math.PI * 2);
   ctx.fill();
   // The strip has to meet itself: whatever hangs off one end is drawn onto the other.
   if (px < 90 || px > WIDTH - 90) {
    ctx.beginPath();
    ctx.arc(px < 90 ? px + WIDTH : px - WIDTH, py, pr, 0, Math.PI * 2);
    ctx.fill();
   }
  }
 }
 ctx.globalAlpha = 1;
}

function paintGradient(ctx: Ctx, stops: [number, string][]) {
 const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
 for (const [at, color] of stops) grad.addColorStop(at, color);
 ctx.fillStyle = grad;
 ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

/**
 * Where the sun halo is painted, in canvas columns. The sky is equirectangular, so column 0 and
 * column `width` are the same direction: a halo near that seam has to be painted on both sides of
 * it or it is simply cut off, and the cut shows in game as a hard vertical edge across the sky
 * (Last Resort's sun sits at about 25 degrees from the seam, so it was). The centres are returned
 * one texture width apart; only the ones whose radius reaches the canvas are worth painting.
 */
function sunGlowCentres(width: number): number[] {
 const cx = (((SUN_GLOW.azimuthDeg + 180) / 360) * width + width) % width;
 const reach = SUN_GLOW.radius * width;
 return [cx - width, cx, cx + width].filter(x => x + reach > 0 && x - reach < width);
}

/** A warm halo around the sun, from its elevation down to the horizon. */
function paintSunGlow(ctx: Ctx) {
 const cy = (1 - (0.5 + SUN_GLOW.elevationDeg / 180)) * HEIGHT;
 const { rgb, strength } = SUN_GLOW;
 for (const cx of sunGlowCentres(WIDTH)) {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, SUN_GLOW.radius * WIDTH);
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${strength})`);
  grad.addColorStop(0.45, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${strength * 0.28})`);
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
 }
}

function paintDesert(ctx: Ctx) {
 paintGradient(ctx, [[0, '#2b5fae'], [0.42, '#6d9fd6'], [0.5, '#c9d3d6'], [0.6, '#dcd3c0'], [1, '#b9a884']]);
 paintClouds(ctx, true);
 paintMesas(ctx);
}

function paintCoastal(ctx: Ctx) {
 paintGradient(ctx, [[0, '#1f63bd'], [0.45, '#5c9ad8'], [0.72, '#93bfe1'], [1, '#bcd6e8']]);
 paintClouds(ctx, false);
 paintSkyline(ctx);
}

function paintClouds(ctx: Ctx, desert: boolean) {
 const clouds = desert ? 12 : 26;
 for (let i = 0; i < clouds; i++) {
  const cx = Math.random() * WIDTH;
  const cy = HEIGHT * (desert ? 0.33 + Math.random() * 0.1 : 0.28 + Math.random() * 0.18);
  const scale = 0.45 + Math.random() * 0.6;
  ctx.globalAlpha = (desert ? 0.55 : 0.85) + Math.random() * 0.15;
  for (let p = 0; p < 6; p++) {
   const px = cx + (Math.random() - 0.5) * (desert ? 90 : 58) * scale;
   const py = cy + (Math.random() - 0.5) * (desert ? 8 : 13) * scale;
   const pr = (9 + Math.random() * 15) * scale;
   const g = ctx.createRadialGradient(px, py - pr * 0.25, pr * 0.15, px, py, pr);
   g.addColorStop(0, 'rgba(249,252,255,0.95)');
   g.addColorStop(0.72, 'rgba(226,238,250,0.6)');
   g.addColorStop(1, 'rgba(210,226,244,0)');
   ctx.fillStyle = g;
   ctx.beginPath();
   ctx.arc(px, py, pr, 0, Math.PI * 2);
   ctx.fill();
  }
 }
 ctx.globalAlpha = 1;
}

const MESAS: [string, number, number, number][] = [
 ['rgba(150,148,170,0.55)', 0.075, 0.6, 3],
 ['rgba(140,118,110,0.7)', 0.05, 0.9, 5],
 ['rgba(128,98,74,0.85)', 0.03, 1.3, 7],
];

function paintMesas(ctx: Ctx) {
 const horizon = HEIGHT * 0.5;
 for (const [color, height, jag, k] of MESAS) {
  const seed = Math.random() * Math.PI * 2, seed2 = Math.random() * Math.PI * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT);
  for (let x = 0; x <= WIDTH; x += 4) {
   const t = (x / WIDTH) * Math.PI * 2;
   let y = 0.5 + 0.5 * Math.sin(t * k + seed);
   y *= 0.6 + 0.4 * Math.sin(t * (k * 2 + 1) + seed2);
   y += 0.12 * Math.abs(Math.sin(t * k * 5 + seed)) * jag;
   ctx.lineTo(x, horizon - Math.max(0, y) * HEIGHT * height);
  }
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.closePath();
  ctx.fill();
 }
}

function paintSkyline(ctx: Ctx) {
 const horizon = HEIGHT * 0.72;
 ctx.fillStyle = 'rgba(150,170,192,0.5)';
 for (let hump = 0; hump < 6; hump++) {
  const cx = (hump + Math.random()) * WIDTH / 6;
  const rw = WIDTH * (0.10 + Math.random() * 0.10), rh = HEIGHT * (0.05 + Math.random() * 0.07);
  ctx.beginPath();
  ctx.ellipse(cx, horizon + rh * 0.35, rw, rh, 0, Math.PI, 0);
  ctx.fill();
 }
 ctx.fillStyle = 'rgba(118,138,163,0.6)';
 for (let x = 0; x < WIDTH;) {
  const bw = 8 + Math.random() * 26, bh = HEIGHT * (0.04 + Math.random() * 0.14);
  ctx.fillRect(x, horizon - bh, bw, bh);
  x += bw + Math.random() * 7;
 }
}
