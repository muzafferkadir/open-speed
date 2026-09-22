// Everything a map canvas needs (circuit polyline, road lines, tile size, terrain field)
// straight from the map JSON and its physics world, without building any 3D scene.

import * as THREE from 'three';
import type { TerrainField } from '../ui/Minimap.ts';
import type { OvalWorld } from '../physics/OvalWorld.ts';
import type { RoadWorld } from '../physics/RoadWorld.ts';
import type { World } from '../physics/types.ts';
import { isOval, isRoad, type GameMap } from './maps.ts';
import type { RoadLine } from './types.ts';

export type MapContext = {
 circuit: THREE.Vector3[];
 roadLines: RoadLine[];
 tile: number;
 terrain?: TerrainField;
};

/** The centre line a minimap draws, before the drive scene exists. */
export function previewCircuit(map: GameMap, world: World): THREE.Vector3[] {
 if (isOval(map)) return (world as OvalWorld).frames.map(f => new THREE.Vector3(f.x, f.y, f.z));
 const road = world as RoadWorld;
 return road.circuit.map(([x, z]) => new THREE.Vector3(x, road.heightAt(x, z) + 1, z));
}

/** Rear-view / menu map data for a loaded map. */
export function mapContext(map: GameMap, world: World): MapContext {
 if (isRoad(map)) return { circuit: previewCircuit(map, world), roadLines: [{ pts: (world as RoadWorld).circuit, width: roadWidth(world as RoadWorld) }], tile: 16 };
 // The oval's own frames are its road: without a line here the menu map drew nothing at all for
 // Proving Grounds - just the start dot on an empty panel.
 const oval = world as OvalWorld;
 return {
  circuit: previewCircuit(map, world),
  roadLines: [{ pts: oval.frames.map(f => [f.x, f.z] as [number, number]), width: oval.halfWidth * 2 }],
  tile: 16,
 };
}

const MAX_MAP_WIDTH = 30;
const DEFAULT_ROAD_WIDTH = 20;

function roadWidth(world: RoadWorld): number {
 const widths = world.frames?.map(f => Math.min(f.left + f.right, MAX_MAP_WIDTH)).sort((a, b) => a - b) ?? [];
 return widths.length ? widths[widths.length >> 1] : DEFAULT_ROAD_WIDTH;
}
