import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { RenderStyle } from '../src/game/RenderStyle.ts';

const scene = () => {
 const root = new THREE.Group();
 const painted = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x884422 }));
 painted.name = 'painted';
 // The sea is a custom program: it owns its whole look, lighting included.
 const sea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  vertexShader: 'void main(){gl_Position=vec4(position,1.);}',
  fragmentShader: 'void main(){gl_FragColor=vec4(0.,.3,.4,1.);}',
 }));
 sea.name = 'shallow-water';
 root.add(painted, sea);
 return { root, painted, sea };
};

test('cartoon restyles ordinary materials', () => {
 const { root, painted } = scene();
 new RenderStyle().apply(root, 'cartoon');
 assert.equal(painted.material.type, 'MeshToonMaterial');
});

test('a custom shader is left alone', () => {
 // Swapping the sea's program for a toon material threw the shader away and left a white sheet
 // where the water had been - on every map with water, for as long as cartoon was the default.
 const { root, sea } = scene();
 const original = sea.material;
 new RenderStyle().apply(root, 'cartoon');
 assert.equal(sea.material, original, 'the water kept its own program');
});

test('switching back puts every original material where it was', () => {
 const { root, painted, sea } = scene();
 const before = [painted.material, sea.material];
 const style = new RenderStyle();
 style.apply(root, 'cartoon');
 style.apply(root, 'off');
 assert.equal(painted.material, before[0]);
 assert.equal(sea.material, before[1]);
});
