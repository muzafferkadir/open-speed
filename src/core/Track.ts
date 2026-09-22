import * as THREE from 'three';
import { isOval, isRoad, loadRoadProps, type GameMap } from '../track/maps.js';
import { OvalScene } from '../track/OvalScene.js';
import { RoadProps } from '../track/RoadProps.js';
import { levelness, RoadScene } from '../track/RoadScene.js';
import type { RoadLine } from '../track/types.js';
import { Race } from '../game/Race.js';
import type { Car } from '../physics/Car.js';
import { OvalWorld } from '../physics/OvalWorld.js';
import { RoadWorld } from '../physics/RoadWorld.js';
import type { World } from '../physics/types.js';
import { buildLandmarks } from '../track/landmarks.js';
import type { Waterfall } from '../track/Waterfall.js';
import { measureWalls } from '../track/measureWalls.js';
import { Occluders } from '../game/occlusion.js';
import type { TerrainField } from '../ui/Minimap.js';

const OPPONENTS = 5;
const DEFAULT_ROAD_WIDTH = 20;
const MAX_MAP_WIDTH = 30;

export type Track = {
 circuit: THREE.Vector3[];
 roadLines: RoadLine[];
 tile: number;
 terrain?: TerrainField;
 race?: Race;
 /** Solid geometry the chase camera and the headlights ask about. */
 occluders?: Occluders;
 /** Waterfalls, whose sheets have to be scrolled each frame. */
 falls?: Waterfall[];
}

/** Above this a surface lies flat enough that a camera above the car only ever skims it. */
const GROUND_LEVEL = 0.985;

/**
 * The meshes the camera and the headlights raycast against: walls, tunnels, cliffs.
 *
 * Cut-out cards (palms, signs) are drawn with a transparent or alpha-tested material and are mostly
 * empty texture, so a ray must ignore them. Ground is left out too, and that is as much about cost
 * as about correctness: the occlusion ray already discards a surface it merely skims, which is all
 * a flat field ever is to a camera sitting above the car. Anything with a slope, a wall or a roof
 * in it stays, however big - Occluders cuts a large mesh into blocks, so size is not a cost.
 */
function isOpenGround(geometry: THREE.BufferGeometry): boolean {
 // Only a surface that is flat through and through - a field, a car park, a stretch of road. The
 // cave is a single 600 m shell that is floor, walls and roof at once, and judging it by its
 // average once dropped the whole thing: the roof stopped blocking the camera and the car
 // disappeared behind the rock.
 return levelness(geometry) >= GROUND_LEVEL;
}

function solidMeshes(root: THREE.Object3D): THREE.Object3D[] {
 const out: THREE.Object3D[] = [];
 root.traverse(node => {
  const mesh = node as THREE.Mesh;
  if (!mesh.isMesh) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.some(m => (m as THREE.MeshStandardMaterial).transparent || (m as THREE.MeshStandardMaterial).alphaTest)) return;
  if (isOpenGround(mesh.geometry)) return;
  out.push(mesh);
 });
 return out;
};

export function createWorld(map: GameMap): World {
 if (isOval(map)) return new OvalWorld(map);
 return new RoadWorld(map);
}

export function startYaw(world: World): number {
 const [[ax, az], [bx, bz]] = world.circuit;
 return Math.atan2(-(bx - ax), -(bz - az));
}

export async function buildTrack(scene: THREE.Scene, map: GameMap, world: World, player: Car, laps?: number): Promise<Track> {
 let falls: Waterfall[] = [];
 const built = isOval(map) ? OvalScene.build(world as OvalWorld) : RoadScene.build(world as RoadWorld);
 scene.add(built.group);
 if (isRoad(map)) {
  const trackMesh = await RoadScene.loadTrackMesh(`/maps/${map.id}-track.glb`);
  if (trackMesh) {
   (built as RoadScene).useTrackMesh();
   scene.add(trackMesh);
  }
  // A few set pieces are slabs standing in for something the 1997 renderer could not draw.
  if (trackMesh) {
   const landmarks = await buildLandmarks(map.id, trackMesh);
   if (landmarks) { scene.add(landmarks.group); falls = landmarks.falls; }
  }
  // The source data draws its roadside scenery as flat cut-out cards; real models replace them.
  const props = await loadRoadProps(map.id).catch(() => null);
  if (props && trackMesh) {
   const roadProps = await RoadProps.build(props);
   if (roadProps) scene.add(roadProps.group);
  }
 }
 // Taken before the cars join the scene: an opponent behind the player must not yank the camera in.
 const occluders = new Occluders(solidMeshes(scene));
 // The corridor the source ships and the rock that is drawn disagree; the rock is the honest one.
 if (isRoad(map)) {
  const walls = measureWalls(world as RoadWorld, occluders);
  (world as RoadWorld).applyMeasuredWalls(walls.left, walls.right);
 }
 const width = isOval(map) ? map.width : medianWidth(world as RoadWorld);
 const race = new Race(world, player, laps || map.laps, OPPONENTS);
 scene.add(race.group);
 // The field has to be in the scene before the caller compiles it, or each car's shaders land as a
 // stall in the opening sweep.
 await race.ready;
 return { circuit: built.circuit, roadLines: [{ pts: world.circuit, width }], tile: 16, race, occluders, falls };
}

function medianWidth(world: RoadWorld): number {
 const widths = world.frames?.map(f => Math.min(f.left + f.right, MAX_MAP_WIDTH)).sort((a, b) => a - b) ?? [];
 return widths.length ? widths[widths.length >> 1] : DEFAULT_ROAD_WIDTH;
}
