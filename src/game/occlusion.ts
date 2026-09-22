import * as THREE from 'three';

/** The camera never sits closer to the car than this, however tight the geometry behind it. */
export const MIN_BACK = 2.6;
/** Clearance kept between the camera and the wall it would otherwise pass through. */
const WALL_MARGIN = 0.5;
/** The ray leaves from above the roof, so a kerb or the car's own body never counts as a wall. */
const PIVOT_UP = 1.8;
/**
 * How head-on the ray has to meet a surface for it to count as a wall, as |cos| of the angle
 * between the ray and the surface normal. A banked oval's own road rises behind the car and the
 * chase ray skims along it; pulling the camera in there would jam it against the car for a whole
 * lap. A tunnel roof or a canyon wall is met far closer to square.
 */
const MIN_HEAD_ON = 0.25;

/**
 * The solid track geometry the camera and the headlights ask about, indexed by world bounding box.
 *
 * A raycast against the raw mesh list is what makes this expensive: three tests each mesh's
 * bounding sphere and then walks its triangles, and a track is a handful of meshes that are
 * hundreds of metres across - their spheres always pass, so every ray walked thousands of
 * triangles. Two things fix that. A mesh bigger than a block is cut into blocks first, so a ray
 * only ever sees the part of it that is nearby; then the ray's own bounding box is tested against
 * each piece's, which leaves a handful out of the hundreds a track carries.
 *
 * Cutting matters for more than speed: the cave on Last Resort is a single 600 m shell that is
 * floor, walls and roof at once, and any rule that judges a whole mesh has to call it one thing.
 */
/** Side of a lookup cell, in metres: a query only walks the cells its ray passes through. */
const CELL = 64;

/** A mesh wider than this is cut into blocks of this size before it is indexed. */
const BLOCK = 48;

const centroid = new THREE.Vector3();
const corner = new THREE.Vector3();

/**
 * The mesh, or the same mesh cut into blocks when it is too big to be useful whole. The pieces
 * share the original's vertex data and carry their own index, so the cut costs indices only, and
 * they are never added to the scene: they exist to be raycast.
 */
function split(mesh: THREE.Mesh): { mesh: THREE.Mesh; box: THREE.Box3 }[] {
 const box = mesh.geometry.boundingBox!;
 const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
 const position = mesh.geometry.getAttribute('position');
 const index = mesh.geometry.getIndex();
 if (size <= BLOCK * 1.5 || !index) return [{ mesh, box: box.clone() }];
 const cells = new Map<string, number[]>();
 const array = index.array;
 for (let i = 0; i + 2 < array.length; i += 3) {
  centroid.set(0, 0, 0);
  for (let k = 0; k < 3; k++) centroid.add(corner.fromBufferAttribute(position, array[i + k]));
  centroid.divideScalar(3);
  const key = `${Math.floor(centroid.x / BLOCK)},${Math.floor(centroid.z / BLOCK)}`;
  const cell = cells.get(key) ?? cells.set(key, []).get(key)!;
  cell.push(array[i], array[i + 1], array[i + 2]);
 }
 if (cells.size < 2) return [{ mesh, box: box.clone() }];
 const pieces: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
 for (const indices of cells.values()) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setIndex(indices);
  const piece = new THREE.Mesh(geometry, mesh.material);
  piece.matrixAutoUpdate = false;
  piece.matrixWorld.copy(mesh.matrixWorld);
  // The pieces share one position attribute, so computeBoundingBox would hand every one of them
  // the whole mesh's bounds and the index would filter nothing at all.
  const bounds = new THREE.Box3();
  for (const i of indices) bounds.expandByPoint(corner.fromBufferAttribute(position, i));
  geometry.boundingBox = bounds.clone();
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  pieces.push({ mesh: piece, box: bounds });
 }
 return pieces;
}

export class Occluders {
 private readonly meshes: THREE.Object3D[] = [];
 private readonly boxes: THREE.Box3[] = [];
 /** Pieces bucketed by world cell, so a query never walks the whole track. */
 private readonly grid = new Map<string, number[]>();
 /** Reused between calls: this runs every frame and must not allocate. */
 private readonly reach = new THREE.Box3();
 private readonly candidates: THREE.Object3D[] = [];
 private readonly seen = new Set<number>();

 constructor(objects: THREE.Object3D[] = []) {
  for (const object of objects) {
   const mesh = object as THREE.Mesh;
   if (!mesh.isMesh) continue;
   mesh.updateWorldMatrix(true, false);
   mesh.geometry.computeBoundingBox();
   if (!mesh.geometry.boundingBox) continue;
   for (const piece of split(mesh)) {
    const box = piece.box.clone().applyMatrix4(piece.mesh.matrixWorld);
    const at = this.meshes.length;
    this.meshes.push(piece.mesh);
    this.boxes.push(box);
    for (let cx = Math.floor(box.min.x / CELL); cx <= Math.floor(box.max.x / CELL); cx++)
     for (let cz = Math.floor(box.min.z / CELL); cz <= Math.floor(box.max.z / CELL); cz++) {
      const key = `${cx},${cz}`;
      (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(at);
     }
   }
  }
 }

 get size(): number { return this.meshes.length; }

 /** The meshes whose bounds a ray from `from` to `to` could touch. The array is reused. */
 along(from: THREE.Vector3, to: THREE.Vector3): THREE.Object3D[] {
  this.reach.makeEmpty().expandByPoint(from).expandByPoint(to);
  this.candidates.length = 0;
  this.seen.clear();
  for (let cx = Math.floor(this.reach.min.x / CELL); cx <= Math.floor(this.reach.max.x / CELL); cx++)
   for (let cz = Math.floor(this.reach.min.z / CELL); cz <= Math.floor(this.reach.max.z / CELL); cz++) {
    const cell = this.grid.get(`${cx},${cz}`);
    if (!cell) continue;
    for (const i of cell) {
     if (this.seen.has(i)) continue;
     this.seen.add(i);
     if (this.boxes[i].intersectsBox(this.reach)) this.candidates.push(this.meshes[i]);
    }
   }
  return this.candidates;
 }
}

const ray = new THREE.Raycaster();
const pivot = new THREE.Vector3();
const dir = new THREE.Vector3();
const normal = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

/** How square-on the ray meets a hit surface, as |cos| between the ray and the surface normal. */
function headOn(hit: THREE.Intersection, direction: THREE.Vector3): number {
 if (!hit.face) return 1;
 normalMatrix.getNormalMatrix(hit.object.matrixWorld);
 normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
 return Math.abs(normal.dot(direction));
}

/**
 * Moves `camera` along the line from the car to wherever the rig wanted it, stopping in front of
 * the first solid surface on the way. Without this the rigid chase keeps its 9 m and simply sinks
 * through a tunnel roof or a wall, and the drive is watched from outside the track.
 *
 * @param occluders solid track meshes only; cut-out cards must be filtered out by the caller.
 * @returns the camera position, moved in place.
 */
export function pullInsideWalls(camera: THREE.Vector3, car: THREE.Vector3, occluders: Occluders): THREE.Vector3 {
 if (!occluders.size) return camera;
 pivot.set(car.x, car.y + PIVOT_UP, car.z);
 dir.copy(camera).sub(pivot);
 const distance = dir.length();
 if (distance < MIN_BACK) return camera;
 dir.divideScalar(distance);
 ray.set(pivot, dir);
 ray.far = distance;
 const hit = ray.intersectObjects(occluders.along(pivot, camera), true).find(candidate => headOn(candidate, dir) >= MIN_HEAD_ON);
 if (hit) camera.copy(pivot).addScaledVector(dir, Math.max(MIN_BACK, hit.distance - WALL_MARGIN));
 return camera;
}
