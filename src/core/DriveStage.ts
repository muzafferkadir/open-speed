// Everything that only exists while driving: the render scene, sky, fog, lights,
// the built track, race and skid marks, plus the HUD minimaps.
// Built on demand (the first start, or when the player picked another map) and
// disposed as a whole, so a map switch never needs a page reload.

import * as THREE from 'three';
import type { GameMap } from '../track/maps.js';
import type { Race } from '../game/Race.js';
import { SkidMarks } from '../game/SkidMarks.js';
import type { Car } from '../physics/Car.js';
import type { World } from '../physics/types.js';
import { Minimap } from '../ui/Minimap.js';
import { $ } from './dom.js';
import { SUN_OFFSET } from '../game/Sky.ts';
import { createStage, followSun, type Stage } from './Stage.js';
import { buildTrack, type Track } from './Track.js';

/** The tone the water gives back when looked at straight down: the sky at its deepest. */
const WATER_ZENITH = new THREE.Color('#2b5fae');

export type DriveStage = {
 mapId: string;
 stage: Stage;
 track: Track;
 race?: Race;
 skids: SkidMarks;
 minimap: Minimap;
 pauseMap: Minimap;
};

export async function buildDriveStage(renderer: THREE.WebGLRenderer, map: GameMap, world: World, player: Car, laps?: number): Promise<DriveStage> {
 const stage = createStage(renderer, map);
 const track = await buildTrack(stage.scene, map, world, player, laps);
 const skids = new SkidMarks(stage.scene);
 // The water reflects the sky, so it has to be told which sky: the fog carries the horizon tone
 // the scene actually paints, and the sun is the one the stage lights with.
 const minimap = new Minimap($<HTMLCanvasElement>('map'), track.circuit, 264, 264, 10, track.roadLines, track.tile, track.terrain, true, 26);
 const pauseMap = new Minimap($<HTMLCanvasElement>('pause-map'), track.circuit, 1024, 1024, 32, track.roadLines, track.tile, track.terrain);
 return { mapId: map.id, stage, track, race: track.race, skids, minimap, pauseMap };
}

/** Drops the built track and its GPU buffers. The scene itself goes with them. */
export function disposeDriveStage(drive: DriveStage) {
 drive.stage.scene.remove(...drive.stage.scene.children);
 drive.stage.scene.traverse(node => {
  const mesh = node as THREE.Mesh;
  if (mesh.isMesh) {
   mesh.geometry?.dispose();
   const material = mesh.material;
   for (const entry of Array.isArray(material) ? material : [material]) entry?.dispose();
  }
 });
 drive.skids.dispose();
}

export { followSun };
