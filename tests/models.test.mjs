import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import vehicles from '../src/data/vehicles.json' with { type: 'json' };

const TOLERANCE = 0.03;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

for (const design of vehicles) {
 test(`${design.id} GLB follows the vehicle standard`, async () => {
  const root = (await io.read(`assets${design.model.url}`)).getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const { min, max } = getBounds(scene);
  assert.ok(Math.abs((min[0] + max[0]) / 2) < TOLERANCE, `off-centre on X: ${(min[0] + max[0]) / 2}`);
  assert.ok(Math.abs(min[1]) < 0.01, `not on the ground: ${min[1]}`);
  assert.ok(max[2] - min[2] > max[0] - min[0], 'length must run along Z');
  const wheels = root.listNodes().filter(node => /^WHL[0-3]_H$/i.test(node.getName()));
  assert.equal(wheels.length, 4, 'expected four WHL[0-3]_H nodes');
  const at = wheels.map(node => node.getWorldTranslation());
  const z = axis => at.filter(p => (axis === 'front') === (p[2] < 0)).reduce((sum, p) => sum + p[2], 0) / 2;
  assert.ok(Math.abs(Math.abs(z('front') - z('rear')) - design.dimensions.wheelbase) < TOLERANCE, 'wheelbase mismatch');
  const track = Math.abs(at.filter(p => p[0] > 0).reduce((s, p) => s + p[0], 0) - at.filter(p => p[0] < 0).reduce((s, p) => s + p[0], 0)) / 2;
  assert.ok(Math.abs(track - design.dimensions.trackWidth) < TOLERANCE, `track width mismatch: ${track}`);
  const lamps = design.visual.lamps;
  if (lamps) {
   assert.ok(lamps.brake && lamps.reverse, 'lamps need both a brake and a reverse mount');
   for (const [kind, lamp] of Object.entries(lamps)) {
    assert.ok(Math.abs(lamp.center[0]) > 0.05, `${kind} lamp on the centre line would not mirror`);
    const [x, y, z] = lamp.center;
    assert.ok(x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2],
     `${kind} lamp centre outside the body: ${lamp.center}`);
    assert.ok(lamp.size[0] > 0 && lamp.size[1] > 0, `${kind} lamp has a non-positive size`);
   }
  }
 });
}

for (const vehicle of vehicles) {
 test(`${vehicle.id} rolls on round wheels`, async () => {
  // A wheel node that is not round tumbles instead of rolling, and one whose centre is not its
  // own radius above the ground digs in or floats. The red car shipped with the front rims cut
  // out by a cylinder too small for them: 0.73 by 1.07 metres, an oval that wobbled as it turned.
  const document = await io.read(`assets/vehicles/${vehicle.id}.glb`);
  const rims = document.getRoot().listNodes().filter(node => /^WHL[0-3]_H$/i.test(node.getName()));
  assert.equal(rims.length, 4, 'four wheel nodes');
  for (const rim of rims) {
   const box = getBounds(rim);
   const across = box.max[1] - box.min[1], along = box.max[2] - box.min[2];
   const radius = Math.max(across, along) / 2;
   assert.ok(Math.abs(across / along - 1) < 0.15, `${rim.getName()} is not round: ${across.toFixed(3)} by ${along.toFixed(3)}`);
   assert.ok(radius > 0.2 && radius < 0.7, `${rim.getName()} radius ${radius.toFixed(3)} m is not a car wheel`);
   const centre = (box.min[1] + box.max[1]) / 2;
   assert.ok(Math.abs(centre - radius) < 0.1, `${rim.getName()} sits at ${centre.toFixed(3)} m but its radius is ${radius.toFixed(3)}`);
  }
 });
}
