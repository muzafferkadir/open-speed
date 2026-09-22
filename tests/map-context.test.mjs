import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { mapContext, previewCircuit } from '../src/track/mapContext.ts';
import { OvalWorld } from '../src/physics/OvalWorld.ts';
import { RoadWorld } from '../src/physics/RoadWorld.ts';

// The Map tab draws a plan view from the map JSON alone, before any 3D scene is built. That
// preview has to agree with the circuit the drive scene and physics use, otherwise the menu map
// frames the wrong shape. Ties mapContext to the real map files under assets/maps/.
const index = JSON.parse(fs.readFileSync('assets/maps/index.json', 'utf8'));

const world = map => (map.kind === 'oval' ? new OvalWorld(map) : new RoadWorld(map));

for (const entry of index) {
 test(`${entry.id}: preview circuit matches its physics world`, () => {
  const map = JSON.parse(fs.readFileSync(`assets/maps/${entry.file}`, 'utf8'));
  const physics = world(map);
  const circuit = previewCircuit(map, physics);
  assert.equal(circuit.length, physics.circuit.length, 'preview and physics circuit must have the same point count');
  for (const [i, [x, z]] of physics.circuit.entries()) {
   assert.ok(Math.abs(circuit[i].x - x) < 1e-6, `${entry.id} point ${i} x`);
   assert.ok(Math.abs(circuit[i].z - z) < 1e-6, `${entry.id} point ${i} z`);
   assert.ok(Number.isFinite(circuit[i].y), `${entry.id} point ${i} y`);
  }
  const context = mapContext(map, physics);
  assert.equal(context.circuit.length, circuit.length);
  assert.ok(context.tile > 0, 'tile size must be positive');
 });
}

test('every map exposes a drivable road line', () => {
 for (const entry of index) {
  const map = JSON.parse(fs.readFileSync(`assets/maps/${entry.file}`, 'utf8'));
  const context = mapContext(map, world(map));
  assert.equal(context.roadLines.length, 1, `${entry.id} road line`);
  assert.ok(context.roadLines[0].width > 0, `${entry.id} road width`);
 }
});
