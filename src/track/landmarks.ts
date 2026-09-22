import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { Waterfall, type WaterfallSpec } from './Waterfall.js';

/**
 * Landmarks that replace a piece of the track mesh.
 *
 * The source ships its own scenery and it is nearly all worth keeping, but a few set pieces are
 * a handful of flat-shaded slabs standing in for something the 1997 renderer could not draw. This
 * is the list of those: the meshes to take out, and the model that goes in their place. It is
 * hand authored per map because it is an art decision, not something measurable.
 */
export type Landmark = {
 model: string;
 /** Where the model's own origin goes, in world metres. */
 x: number; z: number; y: number;
 /** Heading, radians, in the game's convention: 0 faces -Z. */
 yaw: number;
 /** The model is scaled so it stands this tall. */
 height: number;
 /** Meshes of the track this stands in for; they are hidden, never deleted. */
 replaces: string[];
};

/**
 * Waterfalls, which unlike a landmark replace nothing - they hang on a face the map already has.
 *
 * The face is found with `verify:place`: a pixel whose surface normal is level is a wall, and the
 * gap between its point and the ground there is how tall a fall it will take. Guessing these off
 * a screenshot put three set pieces inside a hillside before the tool existed.
 */
export const FALLS: Record<string, (WaterfallSpec & { y: number })[]> = {
 'last-resort': [{
  // The vertical cut on the left of the road at s = 2567, twelve metres of rock above the verge.
  // Measured at pixel 150,300 of a frame from 799,184,160: point 772.2,188.8,129.3 on ground
  // 176.4, normal 0.55, 0, 0.83 - level, so a face rather than a bank.
  x: 772.6, y: 176.4, z: 129.8,
  height: 12, width: 5,
  yaw: Math.atan2(-0.55, -0.83),
 }],
};

export const LANDMARKS: Record<string, Landmark[]> = {
 'last-resort': [{
  // The head the road drives through, at s = 4015 where the route runs due east. The source
  // draws it as fifteen slabs hanging eight metres above the road.
  model: '/scenery/monkey-head.glb',
  x: 636, y: 183.5, z: -227,
  yaw: Math.PI / 2,
  height: 44,
  replaces: ['tex-399', 'tex-400', 'tex-401', 'tex-402', 'tex-403', 'tex-404', 'tex-405', 'tex-406',
   'tex-407', 'tex-408', 'tex-409', 'tex-410', 'tex-411', 'tex-412', 'tex-413'],
 }],
};

/**
 * Puts the map's landmarks in and takes out what they stand in for.
 *
 * The replaced meshes are hidden rather than removed: the track mesh is one loaded object and
 * the game reloads it per drive, so hiding is reversible and leaves the source file alone.
 */
export async function buildLandmarks(mapId: string, track: THREE.Object3D): Promise<{ group: THREE.Group; falls: Waterfall[] } | null> {
 const list = LANDMARKS[mapId];
 if (!list?.length) return null;
 const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 const group = new THREE.Group();
 group.name = 'landmarks';
 for (const landmark of list) {
  const hidden = new Set(landmark.replaces);
  track.traverse(node => { if (hidden.has(node.name)) node.visible = false; });
  const gltf = await loader.loadAsync(landmark.model).catch(() => null);
  if (!gltf) continue;
  const object = gltf.scene;
  const box = new THREE.Box3().setFromObject(object);
  const scale = landmark.height / Math.max(0.001, box.max.y - box.min.y);
  object.scale.setScalar(scale);
  object.position.set(landmark.x, landmark.y, landmark.z);
  object.rotation.y = landmark.yaw;
  object.traverse(node => {
   if (!(node as THREE.Mesh).isMesh) return;
   node.castShadow = true;
   node.receiveShadow = true;
  });
  group.add(object);
 }
 const falls = (FALLS[mapId] ?? []).map(spec => {
  const fall = Waterfall.build(spec);
  fall.group.position.y = spec.y;
  group.add(fall.group);
  return fall;
 });
 return group.children.length ? { group, falls } : null;
}
