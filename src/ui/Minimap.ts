import {terrainHeight, waterDepth, biomeAt, type Landscape} from '../physics/Terrain.ts';
import * as THREE from 'three';
import type { RoadLine } from '../track/types.js';

/** Another car on the map: world position and its livery colour. */
export type MapDot = { x: number; z: number; color: string };

/** Island terrain field for the map: one code per grid cell (see City.terrain). */
export type TerrainField = { w: number; h: number; tile: number; codes: string; landscape?: Landscape; biomes?: {name:string;center:[number,number]}[] };

// Terrain code -> fill colour. Reads like a real map: sea, land, sand, city, docks, lake.
const TERRAIN_COLOR: Record<string, string> = {
 '0': '#183a52', // sea
 '1': '#3f5b39', // nature / land
 '2': '#c9b98a', // beach
 '3': '#565b60', // city
 '4': '#5d5340', // industry
 '5': '#2b6f88', // lake
};

/** Canvas island map: terrain regions, spline roads as real streets, the car.
 *  Overview mode frames the whole island; follow mode is a round, heading-up compass
 *  minimap that zooms in and rotates with the car. */
export class Minimap {
 private readonly context: CanvasRenderingContext2D;
 private readonly minX: number;
 private readonly minZ: number;
 private readonly scale: number;
 private readonly width: number;
 private readonly height: number;
 private readonly offsetX: number;
 private readonly offsetY: number;
 private readonly roadLines: RoadLine[];
 private readonly tile: number;
 private readonly terrain?: TerrainField;
 private readonly terrainImage?: HTMLCanvasElement;
 private readonly follow: boolean;
 private viewTiles: number;

 constructor(canvas: HTMLCanvasElement, points: THREE.Vector3[], width = 180, height = 250, padding = 10,
             roadLines: RoadLine[] = [], tile = 0, terrain?: TerrainField, follow = false, viewTiles = 24) {
  this.roadLines = roadLines;
  this.tile = tile;
  this.terrain = terrain;
  if (terrain?.landscape) {
   const RES=1024;   // higher-res so the zoomed round HUD map stays crisp, not blurry
   const image=document.createElement('canvas');image.width=image.height=RES;
   const ctx=image.getContext('2d')!,pixels=ctx.createImageData(RES,RES);
   const palette={coast:[117,130,97],alpine:[135,146,140],beach:[203,186,139],forest:[72,103,63],town:[154,144,129],harbor:[112,119,122]};
   for(let z=0;z<RES;z++)for(let x=0;x<RES;x++){
    const wx=(x/RES-.5)*terrain.w*terrain.tile,wz=(z/RES-.5)*terrain.h*terrain.tile;
    const depth=waterDepth(terrain.landscape,wx,wz),h=terrainHeight(terrain.landscape,wx,wz);
    const c=depth>0?[34,102-Math.min(45,depth*8),124-Math.min(30,depth*5)]:h<.6?[197,181,142]:palette[biomeAt(wx,wz)];
    const i=(z*RES+x)*4;pixels.data.set([...c,255],i);
   }
   ctx.putImageData(pixels,0,0);this.terrainImage=image;
  }
  this.follow = follow;
  this.viewTiles = viewTiles;
  this.context = canvas.getContext('2d')!;
  this.width = width;
  this.height = height;
  canvas.width = width;
  canvas.height = height;
  const box = new THREE.Box3();
  if (terrain) {
   const halfX = terrain.w / 2 * terrain.tile, halfZ = terrain.h / 2 * terrain.tile;
   box.set(new THREE.Vector3(-halfX, 0, -halfZ), new THREE.Vector3(halfX, 0, halfZ));
  } else if (roadLines.length) {
   for (const line of roadLines) for (const [x, z] of line.pts) box.expandByPoint(new THREE.Vector3(x, 0, z));
  } else {
   box.setFromPoints(points);
  }
  this.minX = box.min.x;
  this.minZ = box.min.z;
  this.scale = Math.min((width - padding * 2) / (box.max.x - box.min.x), (height - padding * 2) / (box.max.z - box.min.z));
  this.offsetX = (width - (box.max.x - box.min.x) * this.scale) / 2;
  this.offsetY = (height - (box.max.z - box.min.z) * this.scale) / 2;
 }

 draw(x: number, z: number, yaw = 0, speed = 0, overview = false, others: MapDot[] = []) {
  if (overview) { this.drawOverview(x, z, others); return; }
  if (this.follow) this.viewTiles += (26 + Math.min(1, Math.abs(speed) / 120) * 18 - this.viewTiles) * .12;
  if (this.follow) { this.drawFollow(x, z, yaw, others); return; }
  this.drawOverview(x, z, others);
 }

 private static dots(ctx: CanvasRenderingContext2D, project: (wx: number, wz: number) => [number, number], others: MapDot[], r: number) {
  for (const o of others) {
   const [px, py] = project(o.x, o.z);
   ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
   ctx.fillStyle = o.color; ctx.strokeStyle = 'rgba(10,12,10,.9)'; ctx.lineWidth = 1;
   ctx.fill(); ctx.stroke();
  }
 }

 /** Whole-island overview (the menu Map tab): fixed rectangular frame. */
 private drawOverview(x: number, z: number, others: MapDot[] = []) {
  const ctx = this.context;
  const large = this.width > 300;
  ctx.clearRect(0, 0, this.width, this.height);
  const cell = Math.max(2, this.tile * this.scale);
  const project = (wx: number, wz: number): [number, number] => [this.offsetX + (wx - this.minX) * this.scale, this.offsetY + (wz - this.minZ) * this.scale];

  if (this.terrainImage && this.terrain) {
   const {w,h,tile}=this.terrain;
   const [px,py]=project(-w*tile/2,-h*tile/2);
   ctx.drawImage(this.terrainImage,px,py,w*tile*this.scale,h*tile*this.scale);
  } else if (this.terrain) {
   const { w, h, tile, codes } = this.terrain;
   for (let gz = 0; gz < h; gz++) for (let gx = 0; gx < w; gx++) {
    ctx.fillStyle = TERRAIN_COLOR[codes[gz * w + gx]] ?? TERRAIN_COLOR['0'];
    const [px, py] = project((gx - w / 2) * tile, (gz - h / 2) * tile);
    ctx.fillRect(Math.floor(px - cell / 2), Math.floor(py - cell / 2), Math.ceil(cell), Math.ceil(cell));
   }
  }
  this.strokeRoads(ctx, project, this.scale, large, null);
  if(large) for(const biome of this.terrain?.biomes??[]){
   const [bx,bz]=project(...biome.center);ctx.font='600 11px system-ui';ctx.textAlign='center';
   ctx.strokeStyle='rgba(20,30,24,.8)';ctx.lineWidth=3;ctx.strokeText(biome.name,bx,bz);
   ctx.fillStyle='#f2efdc';ctx.fillText(biome.name,bx,bz);
  }
  Minimap.dots(ctx, project, others, large ? 5 : 3);
  const [px, py] = project(x, z);
  Minimap.carDot(ctx, px, py, large ? 7 : 4);
 }

 /** Round, heading-up compass minimap (the driving HUD). */
 private drawFollow(x: number, z: number, yaw: number, others: MapDot[] = []) {
  const ctx = this.context, W = this.width, H = this.height;
  // Keep the compass ring aligned with the CSS circular map edge.
  const cx = W / 2, cy = H / 2, radius = Math.min(W, H) / 2;
  const scale = Math.min(W, H) / (this.viewTiles * this.tile);
  const cell = Math.max(2, this.tile * scale);
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();   // round mask kills overflow
  ctx.fillStyle = TERRAIN_COLOR['0']; ctx.fillRect(0, 0, W, H);            // sea base
  ctx.translate(cx, cy); ctx.rotate(yaw);                                 // heading-up: forward points up
  const project = (wx: number, wz: number): [number, number] => [(wx - x) * scale, (wz - z) * scale];
  const reach = Math.ceil(this.viewTiles * 0.72) + 1;

  if (this.terrainImage && this.terrain) {
   const {w,h,tile}=this.terrain;
   const [px,py]=project(-w*tile/2,-h*tile/2);
   ctx.drawImage(this.terrainImage,px,py,w*tile*scale,h*tile*scale);
  } else if (this.terrain) {
   const { w, h, tile, codes } = this.terrain;
   const cgx = Math.round(x / tile + w / 2), cgz = Math.round(z / tile + h / 2);
   const gx0 = Math.max(0, cgx - reach), gx1 = Math.min(w, cgx + reach + 1);
   const gz0 = Math.max(0, cgz - reach), gz1 = Math.min(h, cgz + reach + 1);
   for (let gz = gz0; gz < gz1; gz++) for (let gx = gx0; gx < gx1; gx++) {
    ctx.fillStyle = TERRAIN_COLOR[codes[gz * w + gx]] ?? TERRAIN_COLOR['0'];
    const [px, py] = project((gx - w / 2) * tile, (gz - h / 2) * tile);
    ctx.fillRect(Math.floor(px - cell / 2), Math.floor(py - cell / 2), Math.ceil(cell), Math.ceil(cell));
   }
  }
  this.strokeRoads(ctx, project, scale, false, { x, z, r: reach * this.tile });
  Minimap.dots(ctx, project, others, 3.5);
  ctx.restore();

  // Car marker: a triangle at the centre pointing up (always heading-up here).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5); ctx.closePath();
  ctx.fillStyle = '#f9b64b'; ctx.strokeStyle = '#1a1108'; ctx.lineWidth = 1.5;
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // Compass ring + rotating north marker (screen space, so N always points to true north).
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(233,244,220,.55)'; ctx.stroke();
  const nx = cx + Math.sin(yaw) * (radius - 10), ny = cy - Math.cos(yaw) * (radius - 10);
  ctx.beginPath(); ctx.arc(nx, ny, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,20,16,.78)'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#e94b4b'; ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', nx, ny + 0.5);
 }

 /** Stroke the spline road network. `view` (or null for all) culls lines outside a window. */
 private strokeRoads(ctx: CanvasRenderingContext2D, project: (x: number, z: number) => [number, number],
                     scale: number, large: boolean, view: { x: number; z: number; r: number } | null) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const visible = this.roadLines.filter(line => line.pts.length >= 2 &&
   (!view || line.pts.some(([px, pz]) => Math.abs(px - view.x) <= view.r && Math.abs(pz - view.z) <= view.r)));
  // Two passes over terrain: a dark casing for contrast, then the bright tarmac on top,
  // so the network reads clearly against the map instead of washing out.
  const passes: [string, number][] = this.terrain
   ? [['rgba(20,28,22,.7)', 3], ['#eef2e4', 0]]
   : [[large ? '#c4d39f' : '#eff3d5aa', 0]];
  for (const [colour, grow] of passes) {
   ctx.strokeStyle = colour;
   for (const line of visible) {
    ctx.lineWidth = Math.max(large ? 2 : 1.6, line.width * scale) + grow;
    ctx.beginPath();
    for (let i = 0; i < line.pts.length; i++) {
     const [px, py] = project(line.pts[i][0], line.pts[i][1]);
     if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
   }
  }
 }

 private static carDot(ctx: CanvasRenderingContext2D, px: number, py: number, r: number) {
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f9b64b';
  ctx.strokeStyle = '#1a1108';
  ctx.lineWidth = r > 5 ? 2 : 1;
  ctx.fill();
  ctx.stroke();
 }
}
