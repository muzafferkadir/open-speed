// Measure every scenery GLB and write assets/scenery/catalog.json.
//
// The runtime normalizes each GLB so its height becomes one world unit, it is centred in
// XZ and sits on y=0 (see CityScene.loadParts). The catalog mirrors exactly that normalized
// geometry, because World.ts turns `size`/`min` into collision boxes and generate-city.mjs
// turns `size` into the spacing radius. Heights in metres are chosen per placement, not here.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';

// Trees and bushes are scenery the car drives through, not obstacles.
const PASSABLE = new Set(['palm', 'pine', 'bush']);
// Only a model that really needs blending may ship an alphaMode BLEND material; tests/scenery
// checks the GLBs against this list, so a see-through prop has to be declared here on purpose.
const TRANSPARENT = new Set([]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const catalog = [];
for (const file of fs.readdirSync('assets/scenery').filter(f => f.endsWith('.glb')).sort()) {
  const doc = await io.read('assets/scenery/' + file);
  const box = getBounds(doc.getRoot().listScenes()[0]);
  const height = box.max[1] - box.min[1];
  if (!(height > 0)) throw new Error(`${file}: zero height, cannot normalize`);
  // Same transform CityScene applies: uniform scale by 1/height, centred in XZ, grounded.
  const size = [box.max[0] - box.min[0], height, box.max[2] - box.min[2]].map(v => v / height);
  const id = file.slice(0, -4);
  catalog.push({
    id,
    url: '/scenery/' + file,
    size,
    min: [-size[0] / 2, 0, -size[2] / 2],
    solid: !PASSABLE.has(id),
    transparent: TRANSPARENT.has(id),
  });
}
fs.writeFileSync('assets/scenery/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(catalog.map(x => x.id).join(', '));
