import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { skyBlocked, wantsLight } from '../src/game/headlights.ts';
import { Occluders } from '../src/game/occlusion.ts';

/** A ceiling `y` metres above the car, wide enough to cover any sun direction. */
const roof = y => {
 const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
 mesh.rotation.x = -Math.PI / 2;
 mesh.position.set(0, y, 0);
 mesh.updateMatrixWorld(true);
 return mesh;
};

const car = new THREE.Vector3(0, 0, 0);

test('an open sky is not shade', () => {
 assert.equal(skyBlocked(car, new Occluders()), 0);
 assert.equal(skyBlocked(car, new Occluders([roof(-5)])), 0, 'geometry below the car is not a roof');
});

test('a roof over the car shuts the sky out', () => {
 assert.equal(skyBlocked(car, new Occluders([roof(12)])), 1);
});

test('a car that has left the roof behind sees the sky again', () => {
 assert.equal(skyBlocked(new THREE.Vector3(9999, 0, 9999), new Occluders([roof(12)])), 0);
});

test('one palm overhead is not a tunnel', () => {
 // What this fixes: the lamps were coming on for every stand of trees on the island, because the
 // question asked was whether the sun was blocked and a tree blocks the sun.
 const frond = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
 frond.rotation.x = -Math.PI / 2;
 frond.position.set(0, 9, 0);
 frond.updateMatrixWorld(true);
 const blocked = skyBlocked(car, new Occluders([frond]));
 assert.ok(blocked < 0.6, `a single frond covered ${blocked * 100}% of the sky`);
 assert.equal(wantsLight(blocked, false), false, 'and it must not switch the lamps on');
});

test('the lamps hold their state between the two thresholds', () => {
 // A tunnel mouth must not flick them on and off as the nose goes in.
 assert.equal(wantsLight(0.5, false), false, 'half a roof does not switch them on');
 assert.equal(wantsLight(0.5, true), true, 'but it does not switch them off either');
 assert.equal(wantsLight(0.8, false), true);
 assert.equal(wantsLight(0.2, true), false);
});
