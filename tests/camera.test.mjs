import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Occluders, pullInsideWalls, MIN_BACK } from '../src/game/occlusion.ts';

/** A wall standing across the chase line, `z` metres behind the car. Double sided, the way a
 *  tunnel reads from the inside. */
const wall = z => {
 const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
 mesh.position.set(0, 5, z);
 mesh.updateMatrixWorld(true);
 return mesh;
};

const car = () => new THREE.Vector3(0, 0, 0);
/** Where the rigid chase wants to sit: 9 m back, 3.8 m up. */
const chase = () => new THREE.Vector3(0, 3.8, 9);

test('with nothing in the way the chase keeps its full distance', () => {
 const camera = chase();
 pullInsideWalls(camera, car(), new Occluders());
 assert.deepEqual(camera.toArray(), chase().toArray());
});

test('a tunnel wall behind the car pulls the camera in front of it', () => {
 const camera = chase();
 pullInsideWalls(camera, car(), new Occluders([wall(4)]));
 assert.ok(camera.z < 4, `the camera sank through the wall at z=4: ${camera.z}`);
 assert.ok(camera.z > 2, `the camera ended up on top of the car: ${camera.z}`);
});

test('the car stays in the frame once a wall has pulled the camera in', () => {
 const camera = chase();
 pullInsideWalls(camera, car(), new Occluders([wall(4)]));
 // The rig aims past the car, so all the test asks is that the camera still looks down the
 // same line from behind - never flipped to the far side or below the ground.
 assert.ok(camera.z > 0 && camera.y > 0, `the camera left the chase line: ${camera.toArray()}`);
});

test('a wall tighter than the minimum never puts the camera inside the car', () => {
 const camera = chase();
 pullInsideWalls(camera, car(), new Occluders([wall(1)]));
 assert.ok(camera.distanceTo(car()) >= MIN_BACK - 0.01, `camera collapsed onto the car: ${camera.toArray()}`);
});

test('a wall the camera already sits in front of is left alone', () => {
 const camera = chase();
 pullInsideWalls(camera, car(), new Occluders([wall(20)]));
 assert.deepEqual(camera.toArray(), chase().toArray());
});

test('a slope the ray only skims does not pull the camera in', () => {
 // A banked oval's own road rises behind the car; the chase ray runs almost along it. Treating
 // that as a wall would jam the camera against the car for the whole lap.
 const slope = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
 slope.rotation.x = -Math.PI / 2 - 0.1;
 slope.position.set(0, 2.5, 4);
 slope.updateMatrixWorld(true);
 const camera = chase();
 pullInsideWalls(camera, car(), new Occluders([slope]));
 assert.deepEqual(camera.toArray(), chase().toArray());
});

test('only the meshes a ray can reach are handed to the raycast', () => {
 // The whole point of the index: a track is a few ground meshes kilometres wide whose bounding
 // spheres always pass, so an unindexed raycast walked thousands of triangles every frame.
 const near = wall(4), far = wall(400);
 const set = new Occluders([near, far]);
 assert.equal(set.size, 2);
 const reachable = set.along(new THREE.Vector3(0, 1.8, 0), chase());
 assert.deepEqual(reachable.map(m => m.position.z), [4]);
});

test('a mesh too big to be useful whole is cut up, and only the near part is handed over', () => {
 // The cave on Last Resort is one 600 m shell that is floor, walls and roof at once. Indexed
 // whole it is useless twice over: any rule that judges a mesh has to call it one thing, and its
 // bounds always overlap the ray. The pieces also have to carry their own bounds - they share one
 // position attribute, so computeBoundingBox would hand every piece the whole mesh's box and the
 // index would filter nothing.
 const long = new THREE.Mesh(new THREE.PlaneGeometry(600, 40, 60, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
 long.updateMatrixWorld(true);
 const set = new Occluders([long]);
 assert.ok(set.size > 4, `expected the mesh to be cut into blocks, got ${set.size}`);
 const near = set.along(new THREE.Vector3(-290, 0, 0), new THREE.Vector3(-282, 0, 0));
 assert.ok(near.length >= 1, 'the block the ray is in must be returned');
 assert.ok(near.length < set.size / 2, `a short ray must not pull in the whole mesh: ${near.length} of ${set.size}`);
});
