#!/usr/bin/env node
// Extract the original track geometry (TRK) into a GLB for Open Speed.
//
// Geometry recipe:
//   world vertex = blockReference + v / 256   (v is a signed 16-bit block-local offset)
//   the first `nStickToNextVerts` vertices belong to the NEXT block's reference, so block seams
//   share a position instead of splitting.
//   polygon vertex table is stored low/med/high resolution; only the high-res range is drawn.
//   texture id = COL extra-block 2 table[poly.texture].texNumber, index into <TRACK>0.QFS.
//   each texture-table entry carries an `alignment` word; bits 11-12 are the quad UV rotation
//   ((alignmentData >> 11) & 3), applied here to road and structure polys.
//   structures (extra-block 8) sit at their reference from extra-blocks 7/18/19 (type 1/4 position,
//   type 3 first animation keyframe), else the owning block's reference.
//
// Textures come from `textureDirFor` (scripts/source/dirs.mjs): the sibling `PC` high-res set when
// present, else the geometry folder. Pass `--tex-dir <dir>` to force one.
//
// Usage:
//   node scripts/extract-track.mjs --track TR04 --id last-resort \
//     [--game <dir>] [--tex-dir <dir>] [--out assets/maps/last-resort-track.glb] [--evidence <dir>]
//     [--props assets/maps/last-resort-props.json]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Document, NodeIO } from '@gltf-transform/core';
import { weld, dedup } from '@gltf-transform/functions';
import { readCol, readTrk, XBID } from './source/read.mjs';
import { readFsh, encodePng } from './source/fsh.mjs';
import { dilateKeyed } from './source/dilate.mjs';
import { rotateUV, uvTableFor, isStandingCard } from './source/uv.mjs';
import { cardCentre, dedupeStands } from './source/roadside.mjs';
import { isPalmCard, palmPlacements, SHEET_ROWS, PALM_TEXTURES } from './source/palms.mjs';
import { isShrubCard, shrubPlacements, SHRUB_TEXTURES } from './source/shrubs.mjs';
import { isUmbrellaCard, umbrellaPlacements, UMBRELLA_TEXTURES } from './source/umbrellas.mjs';
import { isWallCard, nearestSpine, wallMirror, wallCardTriangles, wallBasePlacements } from './source/wall.mjs';
import { isHutCard, hutPlacements, HUT_TEXTURES } from './source/hut.mjs';
import { LandField, WATER_LEVEL } from './source/land.mjs';
import { textureDirFor, texturePathFor } from './source/dirs.mjs';

const DEFAULT_GAME = path.join(os.homedir(), 'Dev/open-speed/build/source-game/Game Files/GameData/Tracks/SE');
const args = parse(process.argv.slice(2));

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'help') { out.help = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

if (args.help || !args.track) {
  const lines = fs.readFileSync(new URL(import.meta.url)).toString().split('\n');
  const from = lines.findIndex(l => l.startsWith('// Usage:'));
  const to = lines.findIndex((l, i) => i > from && !l.startsWith('//'));
  console.log(lines.slice(from, to).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(args.help ? 0 : 1);
}

const game = args.game ?? process.env.SOURCE_TRACKS ?? DEFAULT_GAME;
const base = args.track;
const id = args.id ?? base.toLowerCase();
const out = args.out ?? `assets/maps/${id}-track.glb`;
const colPath = path.join(game, `${base}.COL`);
const trkPath = path.join(game, `${base}.TRK`);
const texDir = textureDirFor(game, base, args['tex-dir']);
const texPath = texturePathFor(texDir, base);
for (const file of [colPath, trkPath, texPath]) if (!fs.existsSync(file)) throw new Error(`Missing source: ${file}`);

const col = readCol(fs.readFileSync(colPath));
const texTable = col.byId.get(2)?.textures;
if (!texTable) throw new Error(`${base}.COL has no texture table (extra-block 2)`);
const trk = readTrk(fs.readFileSync(trkPath));
// The collision spine orders the roadside scenery along the route: the wall mirror alternation and
// the verge filter for the wall-base shrubs both read their position from it.
const spine = col.byId.get(XBID.COLLISION)?.collision ?? [];
const spineStep = spine.length > 1
 ? spine.reduce((s, r, i) => i ? s + Math.hypot(r.position[0] - spine[i - 1].position[0], r.position[2] - spine[i - 1].position[2]) : s, 0) / (spine.length - 1)
 : 4;

// --- textures ---------------------------------------------------------------
const archive = readFsh(fs.readFileSync(texPath));
const trackTextures = archive.textures; // index == COL texNumber
const pngCache = new Map();
const usedTex = new Set();
function textureFor(texNumber) {
  if (!pngCache.has(texNumber)) {
    const t = trackTextures[texNumber];
    // Edge-extend the keyed texels so bilinear filtering cannot bleed magenta onto sprite rims.
    pngCache.set(texNumber, t ? encodePng({ width: t.width, height: t.height, rgba: t.keyed > 0 ? dilateKeyed(t.rgba, t.width, t.height) : t.rgba }) : null);
  }
  return pngCache.get(texNumber);
}

// --- geometry ---------------------------------------------------------------
// One bucket per texture id; each bucket is a flat triangle list in world space.
const buckets = new Map();
// Wall cards carry a per-vertex colour (COLOR_0) for their edge shading; every other texture group
// is plain, so only the wall materials pay for the extra attribute.
const has = (m, k, color = false) => m.has(k) ? m.get(k) : m.set(k, { tex: k, pos: [], uv: [], col: color ? [] : null, tris: 0 }).get(k);
// Every texture a replacement model stands in for: those cards are dropped from the GLB.
const replaced = new Set([...PALM_TEXTURES, ...SHRUB_TEXTURES, ...UMBRELLA_TEXTURES, ...HUT_TEXTURES]);
function quad(bucket, p, rot = 0) {
  // Two triangles 0-1-2 and 0-2-3; drop the second when the quad is a triangle.
  const standing = isStandingCard(p);
  // A card a real model replaces is not drawn (the props sidecar carries where it stood instead).
  // Parasol fans and hut roofs are often laid flat (not a standing card), so they are dropped by
  // texture alone.
  if (replaced.has(bucket.tex) && (standing || isUmbrellaCard(bucket.tex) || isHutCard(bucket.tex))) { replacedDropped++; return; }
  const table = uvTableFor(p);
  // The alignment rotation is a property of the texture on the *road* table; on a standing card the
  // UVs are derived from the card's own axes, so a texture-level quarter-turn would tip it over.
  const uv = rot && !standing ? table.map(c => rotateUV(c, rot)) : table;
  // The forest wall gets its texture mirrored on alternate cards and its vertical edges shaded, so a
  // run of cards reads as one hedge instead of the same stamp repeated (scripts/source/wall.mjs).
  if (standing && isWallCard(bucket.tex)) {
    const [cx, cz] = cardCentre(p);
    const near = nearestSpine(spine, cx, cz, spineStep);
    const tris = wallCardTriangles(p, uv, { mirror: near ? wallMirror(near.along) : false });
    for (const t of tris) emitTriangle(bucket, t.p[0], t.p[1], t.p[2], t.uv[0], t.uv[1], t.uv[2], t.col[0], t.col[1], t.col[2]);
    return;
  }
  emitTriangle(bucket, p[0], p[1], p[2], uv[0], uv[1], uv[2]);
  if (p[2] !== p[3]) emitTriangle(bucket, p[0], p[2], p[3], uv[0], uv[2], uv[3]);
}
function emitTriangle(bucket, a, b, c, ua, ub, uc, ca = 1, cb = 1, cc = 1) {
  bucket.pos.push(...a, ...b, ...c);
  bucket.uv.push(...ua, ...ub, ...uc);
  if (bucket.col) bucket.col.push(ca, ca, ca, cb, cb, cb, cc, cc, cc);
  bucket.tris++;
}

let polyCount = 0, structCount = 0, structPolyCount = 0, skipped = 0, replacedDropped = 0;
// Cut-out scenery cards the runtime replaces with real models: the placement list is written to the
// props sidecar and the source card itself is left out of the GLB so nothing is drawn twice.
const palmCards = [], shrubCards = [], umbrellaCards = [], hutCards = [], wallCards = [];
/** True when a card's texture is one a replacement model stands in for. */
const isReplaced = (texNumber) => isPalmCard(texNumber) || isShrubCard(texNumber) || isUmbrellaCard(texNumber) || isHutCard(texNumber);
const collectStanding = (texNumber, quad) => {
  if (isUmbrellaCard(texNumber)) { umbrellaCards.push({ quad }); return; }
  if (isHutCard(texNumber)) { hutCards.push({ quad }); return; }
  if (!isStandingCard(quad)) return;
  if (isWallCard(texNumber)) wallCards.push({ quad });
  if (isPalmCard(texNumber)) {
    // A card carries its own copy of the texture, so its bottom edge is read in the palm art's own
    // sheet frame (SHEET_ROWS rows; the texture's pixel height does not matter, uv.v is 0..1).
    palmCards.push({ quad, row: SHEET_ROWS - 1 });
  } else if (isShrubCard(texNumber)) shrubCards.push({ quad });
};
const texUseCount = new Map();
const texNumberOf = (index) => {
  const t = texTable[index];
  if (!t) { skipped++; return null; }
  usedTex.add(t.texNumber);
  texUseCount.set(t.texNumber, (texUseCount.get(t.texNumber) ?? 0) + 1);
  return t.texNumber;
};
// Bits 11-12 of the COL texture-table alignment word: quad UV rotation in 90 deg steps.
const rotationOf = (index) => ((texTable[index]?.alignment ?? 0) >> 11) & 3;
const rotUseCount = new Map();
const countRot = (n) => rotUseCount.set(n, (rotUseCount.get(n) ?? 0) + 1);

const blocks = trk.blocks;
const refOf = (i) => blocks[i]?.reference ?? blocks[0].reference;
const n = blocks.length;

for (let bi = 0; bi < n; bi++) {
  const b = blocks[bi];
  // Vertex world positions: stick-to-next verts use the following block's reference.
  const nStick = b.nStickToNextVerts, nVerts = b.verts.length;
  const world = new Array(nVerts);
  for (let v = 0; v < nVerts; v++) {
    const ref = v < nStick ? refOf((bi + 1) % n) : refOf(bi);
    const p = b.verts[v];
    world[v] = [ref[0] + p[0] / 256, ref[1] + p[1] / 256, ref[2] + p[2] / 256];
  }

  // High-res polygons only.
  const from = b.nLowResPoly + b.nMedResPoly;
  for (let k = from; k < b.polys.length; k++) {
    const poly = b.polys[k];
    const texNumber = texNumberOf(poly.texture);
    if (texNumber === null) continue;
    const bucket = has(buckets, texNumber, isWallCard(texNumber));
    const v = poly.vertex.map(i => world[i]).filter(Boolean);
    if (v.length < 3) { skipped++; continue; }
    const rot = rotationOf(poly.texture);
    countRot(rot);
    collectStanding(texNumber, v);
    quad(bucket, v, rot);
    polyCount++;
  }

  // Structures (roadside objects).
  const structures = b.byId.get(8)?.structures;
  if (!structures) continue;
  const refs = [];
  for (const blockId of [7, 18, 19]) refs.push(...(b.byId.get(blockId)?.references ?? []));
  for (let si = 0; si < structures.length; si++) {
    const s = structures[si];
    let ref = refOf(bi);
    for (const r of refs) {
      if (r.structure !== si) continue;
      if ((r.type === 1 || r.type === 4) && r.position) { ref = r.position; break; }
      if (r.type === 3 && r.keyframes?.length) { ref = r.keyframes[0]; break; }
    }
    const sw = s.verts.map(p => [ref[0] + p[0] / 256, ref[1] + p[1] / 256, ref[2] + p[2] / 256]);
    for (const poly of s.polys) {
      const texNumber = texNumberOf(poly.texture);
      if (texNumber === null) continue;
      const bucket = has(buckets, texNumber, isWallCard(texNumber));
      const v = poly.vertex.map(i => sw[i]).filter(Boolean);
      if (v.length < 3) { skipped++; continue; }
      const rot = rotationOf(poly.texture);
      countRot(rot);
      collectStanding(texNumber, v);
      quad(bucket, v, rot);
      structPolyCount++;
    }
    structCount++;
  }
}

// --- GLB --------------------------------------------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene(id);
doc.getRoot().setDefaultScene(scene);
const materialCache = new Map();
const missingTextures = [];
function materialFor(texNumber) {
  if (materialCache.has(texNumber)) return materialCache.get(texNumber);
  const mat = doc.createMaterial(`tex-${texNumber}`).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(0.95);
  const png = textureFor(texNumber);
  if (png) {
    const tex = doc.createTexture(`t${texNumber}`).setImage(png).setMimeType('image/png');
    mat.setBaseColorTexture(tex);
    // Cut-out sprites carry the magenta transparency key (see fsh.mjs); switch those materials to
    // alpha masking so the keyed texels drop out instead of drawing solid magenta quads.
    if ((trackTextures[texNumber]?.keyed ?? 0) > 0) mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
  } else {
    missingTextures.push(texNumber);
    mat.setBaseColorFactor([1, 0, 1, 1]);
  }
  materialCache.set(texNumber, mat);
  return mat;
}

const sorted = [...buckets.entries()].sort((a, b) => b[1].tris - a[1].tris);
let totalTri = 0;
// A second copy of the drawn triangles, for the land test below (scripts/source/land.mjs).
const drawn = { positions: [], indices: [] };
for (const [texNumber, bucket] of sorted) {
  const pos = new Float32Array(bucket.pos);
  if (!pos.length) continue;
  totalTri += bucket.tris;
  const baseVertex = drawn.positions.length / 3;
  drawn.positions.push(...bucket.pos);
  for (let i = 0; i < bucket.pos.length / 3; i++) drawn.indices.push(baseVertex + i);
  const uv = new Float32Array(bucket.uv);
  const posAcc = doc.createAccessor(`p${texNumber}`).setType('VEC3').setArray(pos).setBuffer(buffer);
  const uvAcc = doc.createAccessor(`u${texNumber}`).setType('VEC2').setArray(uv).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setAttribute('TEXCOORD_0', uvAcc).setMaterial(materialFor(texNumber));
  if (bucket.col) prim.setAttribute('COLOR_0', doc.createAccessor(`c${texNumber}`).setType('VEC3').setArray(new Float32Array(bucket.col)).setBuffer(buffer));
  const mesh = doc.createMesh(`mesh-${texNumber}`).addPrimitive(prim);
  scene.addChild(doc.createNode(`tex-${texNumber}`).setMesh(mesh));
}

// Index the triangle soup and drop byte-identical texture copies. weld() only merges vertices that
// share position, UV and normal, so per-poly UV rotation and texture seams survive; dedup() folds
// source textures whose decoded bytes are identical (12 copies in TR04's archive). Measured:
// 111357 -> 68924 vertices, 367 -> 355 textures, triangles unchanged at 37119.
await doc.transform(weld(), dedup());

fs.mkdirSync(path.dirname(out), { recursive: true });
const io = new NodeIO();
await io.write(out, doc);
const size = fs.statSync(out).size;
let drawnTri = 0, drawnVert = 0, indexed = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const p = prim.getAttribute('POSITION'); if (p) drawnVert += p.getCount();
  const i = prim.getIndices(); if (i) { drawnTri += i.getCount() / 3; indexed++; }
}

// --- report -----------------------------------------------------------------
const bounds = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
for (const [, bucket] of buckets) {
  for (let i = 0; i < bucket.pos.length; i += 3) {
    bounds.x[0] = Math.min(bounds.x[0], bucket.pos[i]); bounds.x[1] = Math.max(bounds.x[1], bucket.pos[i]);
    bounds.y[0] = Math.min(bounds.y[0], bucket.pos[i + 1]); bounds.y[1] = Math.max(bounds.y[1], bucket.pos[i + 1]);
    bounds.z[0] = Math.min(bounds.z[0], bucket.pos[i + 2]); bounds.z[1] = Math.max(bounds.z[1], bucket.pos[i + 2]);
  }
}
const r = (v) => v.toFixed(1);
const texDims = {};
for (const n of usedTex) { const t = trackTextures[n]; if (t) texDims[`${t.width}x${t.height}`] = (texDims[`${t.width}x${t.height}`] ?? 0) + 1; }
const rotCounts = Object.fromEntries([...rotUseCount.entries()].sort((a, b) => a[0] - b[0]));
console.log(`[1] ${base}.TRK -> ${out} (${(size / 1048576).toFixed(2)} MB)`);
console.log(`[2] ${blocks.length} blocks, ${polyCount} high-res polys, ${structCount} structures (${structPolyCount} polys)`);
console.log(`[3] ${totalTri} triangles in ${buckets.size} texture groups, ${doc.getRoot().listTextures().length} textures embedded`);
console.log(`[3b] drawn: ${drawnTri} triangles, ${drawnVert} vertices, ${indexed}/${buckets.size} primitives indexed`);
console.log(`[4] textures from ${texDir} (${JSON.stringify(texDims)})`);
console.log(`[5] UV rotations (polys): ${JSON.stringify(rotCounts)}`);
console.log(`[6] bounds x ${r(bounds.x[0])}..${r(bounds.x[1])}  y ${r(bounds.y[0])}..${r(bounds.y[1])}  z ${r(bounds.z[0])}..${r(bounds.z[1])} m`);

// --- replacement prop stands -------------------------------------------------
// The source draws its roadside scenery as flat cut-out cards. The runtime stands real models there
// (src/track/RoadProps.ts): palms at the source's own sheet baseline, shrubs and parasols on the
// terrain under each card's base edge. The extractor reports every stand, drops the cards it replaced from the GLB (above),
// and writes the list to the props sidecar so the placement stays reproducible from the original.
const land = new LandField(drawn.positions, drawn.indices);
// A plant stands on the ground under its own base edge; where the mesh draws more than one surface
// over that point `groundAt` picks the ground (a near-horizontal surface when there is one, else the
// one nearest the card's bottom edge), so a slab floating over the beach cannot win.
const groundAt = (x, z, base) => {
 const y = land.groundAt(x, z, base);
 return y !== null && y > WATER_LEVEL ? y : null;
};
const palms = palmPlacements(palmCards).filter(p => land.isLand(p[0], p[2]));
// Shrubs come from two sources: the source's own low foliage cards, plus a row planted at the base of
// every wall card near the route so the forest wall's ground line is broken up.
const shrubs = dedupeStands([...shrubPlacements(shrubCards, groundAt), ...wallBasePlacements(wallCards, groundAt, spine)]);
const umbrellas = umbrellaPlacements(umbrellaCards, groundAt);
const huts = hutPlacements(hutCards, groundAt);
if (args.props) {
  const sidecar = {
    schema: 1,
    replaced: [...replaced].sort((a, b) => a - b),
    stands: [
      { model: 'palm', points: palms.map(p => p.map(v => +v.toFixed(3))) },
      { model: 'bush', points: shrubs.map(p => p.map(v => +v.toFixed(3))) },
      { model: 'umbrella', points: umbrellas.map(p => p.map(v => +v.toFixed(3))) },
      { model: 'hut', points: huts.map(p => p.map(v => +v.toFixed(3))) },
    ],
  };
  fs.writeFileSync(args.props, JSON.stringify(sidecar));
  const span = (list) => list.length ? `${Math.min(...list.map(p => p[3])).toFixed(1)}..${Math.max(...list.map(p => p[3])).toFixed(1)} m` : 'none';
  console.log(`[10] props -> ${args.props}: palms ${palms.length} from ${palmCards.length} cards (${span(palms)}), shrubs ${shrubs.length} from ${shrubCards.length}+${wallCards.length} wall cards (${span(shrubs)}), umbrellas ${umbrellas.length} from ${umbrellaCards.length} cards, huts ${huts.length} from ${hutCards.length} cards`);
}
console.log(`[10b] dropped ${replacedDropped} replaced standing-card triangles (${replaced.size} texture ids)`);
if (missingTextures.length) console.log(`[7] missing texture entries: ${missingTextures.length}`);
if (skipped) console.log(`[8] skipped degenerate/out-of-table polys: ${skipped}`);

if (args.evidence) {
  fs.mkdirSync(args.evidence, { recursive: true });
  fs.writeFileSync(path.join(args.evidence, `${base}-trk-mesh.json`), JSON.stringify({
    track: base, source: { trk: `${base}.TRK`, col: `${base}.COL`, textures: `${path.basename(texDir)}/${path.basename(texPath)}` },
    blocks: blocks.length, highResPolys: polyCount, structures: structCount, structurePolys: structPolyCount,
    triangles: totalTri, textureGroups: buckets.size, texturesUsed: [...usedTex].sort((a, b) => a - b),
    drawn: { triangles: drawnTri, vertices: drawnVert, indexedPrimitives: indexed, textures: doc.getRoot().listTextures().length },
    textureDimensions: texDims, uvRotations: rotCounts,
    palms: { cards: palmCards.length, placements: palms.map(p => p[3]) },
    shrubs: { cards: shrubCards.length, wallCards: wallCards.length, placements: shrubs.map(p => p[3]) },
    umbrellas: { cards: umbrellaCards.length, placements: umbrellas.map(p => p[3]) },
    huts: { cards: hutCards.length, placements: huts.map(p => p[3]) },
    replaced: { textures: [...replaced].sort((a, b) => a - b), droppedTriangles: replacedDropped },
    missingTextures, bounds,
  }, null, 1));
  console.log(`[9] evidence -> ${path.join(args.evidence, `${base}-trk-mesh.json`)}`);
}
