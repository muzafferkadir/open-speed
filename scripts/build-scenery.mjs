// Turn a raw source into a canonical assets/scenery/<id>.glb.
//
// The runtime normalizes every scenery GLB on load (height -> 1 unit, centred in XZ,
// sitting on y=0), so this script only has to guarantee four things:
//   - a single top-level object (multi-object kits would otherwise be placed as one prop),
//   - a deterministic orientation (source files arrive nose-up, back-down or in Y-up),
//   - the model standard: sitting on y=0 and centred on X/Z,
//   - small, web-friendly textures.
//
// Usage: node scripts/build-scenery.mjs <id> [--source path] [--rotate x,y,z deg] [--keep N]
//        [--tint r,g,b]   (multiplies every material's base colour; values are linear, <= 1)
//        [--drop name,...] (drops named nodes, for a kit that holds several props)
//        (--keep N keeps the N largest meshes of a kit layout)
// Sources live outside the repo ($OPEN_SPEED_SOURCE or build/scenery-source/<id>/).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, metalRough } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [id, ...rest] = process.argv.slice(2);
if (!id) throw new Error('usage: build-scenery.mjs <id> [--source path] [--rotate x,y,z] [--keep N]');
const opt = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };

const sourceRoot = process.env.OPEN_SPEED_SOURCE ?? path.join(process.env.HOME ?? '', 'Dev/open-speed/build/source');
// Sketchfab archives arrive either as a packaged .glb or an extracted .gltf + .bin + textures.
const candidates = [
  opt('--source', ''),
  path.join(root, 'build/scenery-source', id, `${id}.glb`),
  path.join(root, 'build/scenery-source', id, 'scene.glb'),
  ...['.gltf', '.glb'].flatMap(ext => [
    path.join(root, 'build/scenery-source', id, `${id}${ext}`),
    path.join(root, 'build/scenery-source', id, `scene${ext}`),
    path.join(sourceRoot, 'scenery', id, `scene${ext}`),
    path.join(sourceRoot, 'scenery', `${id}${ext}`),
  ]),
].filter(Boolean);
const source = candidates.find(p => fs.existsSync(p));
if (!source) throw new Error(`no source for '${id}': tried ${candidates.join(', ')}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(source);

// Sketchfab ships some models in the spec/gloss workflow. The runtime loader (three.js) has no
// support for KHR_materials_pbrSpecularGlossiness, so those materials fall back to a white,
// textureless default and the prop renders as a see-through ghost tinted by the sky. Convert to
// metal/rough here, where the diffuse texture becomes a real base colour texture.
if (doc.getRoot().listMaterials().some(material => material.getExtension('KHR_materials_pbrSpecularGlossiness'))) {
  await doc.transform(metalRough());
  console.log(`${id}: converted spec/gloss -> metal/rough`);
}

const scene = doc.getRoot().listScenes()[0];

// Mesh nodes live at an arbitrary depth (Sketchfab nests scene > model > fbx > meshes), so
// walk the whole tree instead of assuming a fixed number of wrappers.
const meshNodes = [];
const nodes = [];
const collect = node => {
  nodes.push(node);
  if (node.getMesh()) meshNodes.push(node);
  for (const child of node.listChildren()) collect(child);
};
for (const child of scene.listChildren()) collect(child);

// Drop named nodes (and their subtrees), for a kit that lays several props out in one file.
const drop = (opt('--drop', '')).split(',').filter(Boolean);
if (drop.length) {
  const names = new Set(drop);
  for (const node of nodes) if (names.has(node.getName())) node.dispose();
}

// Keep the largest meshes only, so a kit layout becomes one prop.
const keep = Number(opt('--keep', '0'));
if (keep > 0) {
  meshNodes.sort((a, b) => meshVolume(b) - meshVolume(a));
  for (const node of meshNodes.slice(keep)) node.dispose();
}

// Bake an explicit rotation into every mesh node so the file is Y-up for the runtime.
const [rx, ry, rz] = (opt('--rotate', '0,0,0')).split(',').map(Number);
if (rx || ry || rz) {
  for (const node of meshNodes) node.setRotation(quat(rx, ry, rz));
}

// Retune a material's albedo without touching the artwork: glTF multiplies the base colour
// texture by `baseColorFactor` (linear), so multiplying is a hue/value shift the GLB keeps.
const tint = opt('--tint', '');
if (tint) {
  const [r, g, b] = tint.split(',').map(Number);
  if (![r, g, b].every(v => Number.isFinite(v) && v > 0)) throw new Error(`bad --tint: ${tint}`);
  for (const material of doc.getRoot().listMaterials()) {
    const [mr, mg, mb, ma] = material.getBaseColorFactor();
    material.setBaseColorFactor([mr * r, mg * g, mb * b, ma]);
  }
  console.log(`${id}: tint ${tint}`);
}

// Bake the model standard: sit on y = 0 and centre on X/Z. The scene root carries the source
// up-axis rotation, so nudging its translation is a world-space move and cannot tip a model over.
const box = getBounds(scene);
const shift = [-(box.min[0] + box.max[0]) / 2, -box.min[1], -(box.min[2] + box.max[2]) / 2];
if (!shift.every(v => Math.abs(v) < 1e-6)) {
  for (const child of scene.listChildren()) {
    const t = child.getTranslation();
    child.setTranslation([t[0] + shift[0], t[1] + shift[1], t[2] + shift[2]]);
  }
  console.log(`${id}: grounded and centred ${shift.map(v => Math.round(v * 1000) / 1000)}`);
}

const tmp = path.join(root, 'build/scenery-source', `${id}.normalized.glb`);
await io.write(tmp, doc);

// Optimize in place into the canonical asset directory (meshopt + webp, no joining).
fs.mkdirSync(path.join(root, 'assets/scenery'), { recursive: true });
const out = path.join(root, 'assets/scenery', `${id}.glb`);
execFileSync('npx', ['gltf-transform', 'optimize', tmp, out,
  '--compress', 'meshopt', '--simplify', 'false', '--texture-compress', 'webp',
  '--flatten', 'false', '--join', 'false', '--instance', 'false'], { cwd: root, stdio: 'ignore' });
fs.rmSync(tmp, { force: true });

const check = await io.read(out);
const bound = getBounds(check.getRoot().listScenes()[0]);
const size = [bound.max[0] - bound.min[0], bound.max[1] - bound.min[1], bound.max[2] - bound.min[2]].map(v => Math.round(v * 1000) / 1000);
console.log(`${id}: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB, bbox ${JSON.stringify(size)}, min ${JSON.stringify(bound.min.map(v => Math.round(v * 1000) / 1000))}`);

// Rough size of one node's geometry, used to pick the biggest piece of a kit layout.
function meshVolume(node) {
  const position = node.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION');
  if (!position) return 0;
  const array = position.getArray();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < array.length; i += 3) {
    minX = Math.min(minX, array[i]); maxX = Math.max(maxX, array[i]);
    minY = Math.min(minY, array[i + 1]); maxY = Math.max(maxY, array[i + 1]);
    minZ = Math.min(minZ, array[i + 2]); maxZ = Math.max(maxZ, array[i + 2]);
  }
  return (maxX - minX) * (maxY - minY) * (maxZ - minZ);
}

function quat(xDeg, yDeg, zDeg) {
  const [x, y, z] = [xDeg, yDeg, zDeg].map(d => (d * Math.PI) / 180 / 2);
  const [sx, cx] = [Math.sin(x), Math.cos(x)];
  const [sy, cy] = [Math.sin(y), Math.cos(y)];
  const [sz, cz] = [Math.sin(z), Math.cos(z)];
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}
