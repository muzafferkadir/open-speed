import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { levelness } from '../src/track/RoadScene.ts';

const flat = () => new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2);

test('a level field reads as flat', () => {
 assert.ok(levelness(flat()) > 0.99, `${levelness(flat())}`);
});

test('a wall reads as vertical', () => {
 assert.ok(levelness(new THREE.PlaneGeometry(100, 100)) < 0.01);
});

test('a gentle dune still counts as ground, a cliff does not', () => {
 const dune = flat().rotateX(THREE.MathUtils.degToRad(20));
 const cliff = flat().rotateX(THREE.MathUtils.degToRad(70));
 assert.ok(levelness(dune) > 0.8, `a 20 degree slope must smooth: ${levelness(dune)}`);
 assert.ok(levelness(cliff) < 0.8, `a 70 degree face must not: ${levelness(cliff)}`);
});

test('an empty geometry is not mistaken for ground', () => {
 assert.equal(levelness(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3))), 0);
});
