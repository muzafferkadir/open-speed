// Decimates the models that are drawn many times or drawn close to the camera every frame.
//
// Usage: node scripts/simplify-models.mjs [id ...]      (default: every id in BUDGETS)
//
// Last Resort draws 1430 shrubs and 1060 palms, and the shrub alone was 3097 triangles: over four
// million triangles a frame for scenery the driver sees as a green clump at speed. The opponents
// were no better - five cars of 163k each, all of them casting shadows. Budgets are per model and
// deliberate; run the model viewer after changing one (npm run verify:model -- /scenery/bush.glb).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename } from 'node:path';

/**
 * Triangle budget per model, and how far the simplifier may move a vertex to reach it (as a
 * fraction of the model's size). A budget is what the model is worth at the distance it is seen:
 * a car fills the screen and keeps its lines, a shrub at the roadside is a green clump at speed
 * and can be collapsed hard.
 *
 * `thin` allows whole cards to be dropped when collapsing edges cannot reach the budget. It is
 * only ever right for foliage: on a structure it deletes beams and planks and leaves a wreck.
 *
 * `out` writes the result to another file instead of in place, which is how a model gets a low
 * detail twin: the opponents are all the same car, so they read the twin while the player's own
 * car keeps its detail. (The Blender path is not for vehicles - it joins the meshes, and a car
 * needs its wheel nodes.)
 *
 * `bodyOnly` leaves the wheels alone. A car wears a wheel that was modelled on its own and already
 * decimated to its own budget in the bake; simplifying the whole car again takes the wheel down
 * with the body, and collapsing a tread groove leaves a hole in the tyre. The budget then counts
 * the body's triangles, not the car's. The low detail twin is still made from the whole car,
 * because at the distance it is seen a torn tread is not something anyone can make out.
 *
 * `blender` sends the model to scripts/remesh-model.py instead. meshopt will not collapse an edge
 * between two separate shells, so a model assembled from them - a pile of boulders, a building cut
 * into parts - stalls at two thirds of its size however hard it is pushed. Blender's collapse goes
 * straight through that and keeps the UVs, so the original texture comes along.
 */
const BUDGETS = {
 'assets/scenery/bush.glb': { triangles: 400, error: 0.5, thin: true },
 'assets/scenery/palm.glb': { triangles: 520, error: 0.2 },
 'assets/scenery/rock.glb': { triangles: 1200, blender: true },
 'assets/scenery/heritage.glb': { triangles: 2000, blender: true },
 'assets/scenery/crane.glb': { triangles: 2200, blender: true },
 'assets/vehicles/marlin-f1.glb': { triangles: 55000, error: 0.004, bodyOnly: true },
 'assets/vehicles/marlin-f1-lod.glb': { triangles: 32000, error: 0.02, from: 'assets/vehicles/marlin-f1.glb' },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
 'meshopt.decoder': MeshoptDecoder,
 'meshopt.encoder': MeshoptEncoder,
 'meshopt.simplifier': MeshoptSimplifier,
});

const triangles = document => document.getRoot().listMeshes()
 .flatMap(mesh => mesh.listPrimitives())
 .reduce((total, p) => total + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

/**
 * Drops whole leaves until the primitive fits its budget, and returns the triangles kept.
 *
 * Foliage is built from hundreds of separate cards, and an edge-collapse simplifier can do very
 * little with it: there are no shared edges to collapse, so the shrub stopped at 954 triangles
 * whatever ratio it was given. Thinning removes entire cards instead, spread evenly through the
 * mesh, which at the distance a roadside shrub is seen reads as slightly sparser foliage.
 */
function thin(primitive, budget) {
 const indices = primitive.getIndices();
 if (!indices) return null;
 const array = indices.getArray();
 const faces = array.length / 3;
 // Union-find over the vertices: every card is its own island.
 const parent = new Int32Array(primitive.getAttribute('POSITION').getCount());
 for (let i = 0; i < parent.length; i++) parent[i] = i;
 const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
 for (let f = 0; f < faces; f++) {
  const a = find(array[f * 3]), b = find(array[f * 3 + 1]), c = find(array[f * 3 + 2]);
  parent[b] = a; parent[c] = a;
 }
 const islands = new Map();
 for (let f = 0; f < faces; f++) {
  const key = find(array[f * 3]);
  const list = islands.get(key) ?? islands.set(key, []).get(key);
  list.push(f);
 }
 const order = [...islands.values()];
 if (order.length < 4) return null; // one solid body: nothing to thin without holing it
 const keepEvery = faces / budget;
 const kept = [];
 let carried = 0;
 for (const island of order) {
  carried += 1;
  if (carried < keepEvery) continue;
  carried -= keepEvery;
  for (const f of island) kept.push(array[f * 3], array[f * 3 + 1], array[f * 3 + 2]);
 }
 if (!kept.length) return null;
 indices.setArray(new Uint32Array(kept));
 return kept.length / 3;
}

const wanted = process.argv.slice(2);
for (const [file, { triangles: budget, error, thin: mayThin, blender, from, bodyOnly }] of Object.entries(BUDGETS)) {
 if (wanted.length && !wanted.some(id => file.includes(id))) continue;
 const source = from ?? file;
 if (!fs.existsSync(source)) { console.warn(`${source}: missing`); continue; }
 const document = await io.read(source);
 const before = triangles(document);
 if (before <= budget && !from && !bodyOnly) { console.log(`${file}: ${before} tris, already inside ${budget}`); continue; }
 if (blender) {
  const staged = `${tmpdir()}/${basename(file)}`;
  execFileSync('blender', ['-b', '--python', 'scripts/remesh-model.py', '--', file, staged, String(budget)], { stdio: 'ignore' });
  fs.copyFileSync(staged, file);
  fs.rmSync(staged);
  console.log(`${file}: ${before} -> ${triangles(await io.read(file))} tris (blender, budget ${budget})`);
  continue;
 }
 // weld first: a model exported with split vertices has nothing for the simplifier to collapse.
 await document.transform(weld());
 if (bodyOnly) {
  const turning = new Set(document.getRoot().listNodes()
   .filter(node => /^WHL[0-3]_H$/i.test(node.getName())).map(node => node.getMesh()));
  const body = document.getRoot().listMeshes().filter(mesh => !turning.has(mesh));
  const kept = triangles(document) - body.flatMap(m => m.listPrimitives())
   .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  const ratio = budget / (before - kept);
  for (const mesh of body)
   for (const primitive of mesh.listPrimitives()) {
    const simpler = simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio, error });
    if (simpler !== primitive) { mesh.addPrimitive(simpler); mesh.removePrimitive(primitive); primitive.dispose(); }
   }
 } else {
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / before, error }));
 }
 let after = triangles(document);
 if (mayThin && after > budget * 1.2) {
  for (const mesh of document.getRoot().listMeshes())
   for (const primitive of mesh.listPrimitives()) {
    const share = ((primitive.getIndices()?.getCount() ?? 0) / 3) / after;
    if (share > 0.05) thin(primitive, Math.max(24, Math.round(budget * share)));
   }
  after = triangles(document);
 }
 await io.write(file, document);
 console.log(`${file}: ${before} -> ${Math.round(after)} tris (budget ${budget})`);
}
