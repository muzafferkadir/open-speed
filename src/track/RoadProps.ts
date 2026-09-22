// Real 3D scenery for a route built from source track data.
//
// The source data draws its roadside scenery -- palms, shrubs -- as flat cut-out cards. The route
// extractor reports where those cards stand (assets/maps/<id>-props.json, scripts/source/palms.mjs and
// shrubs.mjs) together with the height of the sprite art, and this module draws a real model at
// each point instead: one InstancedMesh per mesh of every model, so a whole run of a plant is a
// single draw call per material. The placements carry the source's own ground height and the yaw is
// a hash of the point, so a rebuild is byte-identical and a row of the same plant does not read as
// a copy.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { RoadProp, RoadPropsFile } from './types.ts';

const YAW_GOLDEN = 0x9e3779b9, YAW_MIX = 0x85ebca6b;
// Instances are grouped into world-space cells so the renderer can frustum-cull a cell that is off
// screen; one mesh for the whole island would never be culled, which is the whole wall at once.
const CELL = 128;

const sceneryUrl = (model: string) => `/scenery/${model}.glb`;

/** Deterministic yaw per instance. */
function yawAt(index: number): number {
 const h = Math.imul(index ^ YAW_GOLDEN, YAW_MIX) >>> 0;
 return (h / 4294967296) * Math.PI * 2;
}

/** Every replacement scenery stand of a road map as real geometry. */
export class RoadProps {
 readonly group = new THREE.Group();
 readonly count: number;

 private constructor(group: THREE.Group, count: number) {
  this.group = group;
  this.count = count;
 }

 /** Null when the route ships no prop placements (a track that has not been converted yet). */
 static async build(data: RoadPropsFile | null): Promise<RoadProps | null> {
  const props = data?.stands.filter(prop => prop.points.length);
  if (!props?.length) return null;
  const group = new THREE.Group();
  group.name = 'road-props';
  let count = 0;
  for (const prop of props) {
   const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(sceneryUrl(prop.model));
   gltf.scene.updateWorldMatrix(true, true);
   // One scale for the whole model: a kit piece (a parasol canopy, a pole) is scaled to the target
   // height by itself would blow that piece out of proportion and detach it from the rest.
   const box = new THREE.Box3().setFromObject(gltf.scene), unit = box.max.y - box.min.y || 1;
   for (const mesh of meshesOf(gltf.scene)) for (const chunk of chunks(mesh, prop, unit)) group.add(chunk);
   count += prop.points.length;
  }
  return new RoadProps(group, count);
 }
}

/** Drawable meshes of a loaded scenery GLB, in file order. */
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
 const meshes: THREE.Mesh[] = [];
 root.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
 return meshes;
}

/** The scenery model normalized to height 1 (scripts/build-scenery-catalog.mjs), so `h` scales it. */
function chunks(mesh: THREE.Mesh, prop: RoadProp, unit: number): THREE.InstancedMesh[] {
 const cells = new Map<string, { point: [number, number, number, number]; index: number }[]>();
 prop.points.forEach((point, index) => {
  const key = `${Math.floor(point[0] / CELL)},${Math.floor(point[2] / CELL)}`;
  const list = cells.get(key) ?? cells.set(key, []).get(key)!;
  list.push({ point, index });
 });
 return [...cells.values()].map(items => instances(mesh, prop, unit, items));
}

function instances(mesh: THREE.Mesh, prop: RoadProp, unit: number, items: { point: [number, number, number, number]; index: number }[]): THREE.InstancedMesh {
 const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, items.length);
 instances.name = `${prop.model}-${mesh.name || 'mesh'}`;
 // The scenery casts. A palm that throws nothing onto the road reads as a sticker on the
 // background; its shadow across the tarmac is most of what puts it in the world.
 instances.castShadow = true;
 instances.receiveShadow = true;
 const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
 const axis = new THREE.Vector3(0, 1, 0), matrix = new THREE.Matrix4();
 items.forEach(({ point: [x, y, z, height], index }, i) => {
  position.set(x, y, z);
  quaternion.setFromAxisAngle(axis, yawAt(index));
  scale.setScalar(height / unit);
  instances.setMatrixAt(i, matrix.compose(position, quaternion, scale).multiply(mesh.matrixWorld));
 });
 instances.instanceMatrix.needsUpdate = true;
 instances.computeBoundingSphere();
 return instances;
}
