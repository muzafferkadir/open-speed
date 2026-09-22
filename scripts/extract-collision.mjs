#!/usr/bin/env node
// Extract a drivable route from a source track (COL block 15 "vector road").
//
// The collision block is the game's own road definition: a spine point every ~4 m with the
// surface frame (up / forward / right) and the left/right limits. Units are metres:
// spine positions are 16.16 fixed, the frame vectors are signed bytes with a norm of ~126, and
// the limits are 1/256 m measured along `right` (validated against the TRK road mesh edges:
// block 0 of TR03 has its asphalt edge at +10.46 m against rightBorder 2702/256 = 10.55 m).
// The lateral axis keeps the source's vertical component, so a banked surface is offset along
// the slope exactly as the original formula does.
//
// Usage:
//   node scripts/extract-collision.mjs --track TR04 --name "Last Resort" \
//     [--game <dir>] [--id last-resort] [--out <file>] [--evidence <dir>] [--laps 3]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCol, readTrk } from './source/read.mjs';
import { hrz3PathFor } from './source/dirs.mjs';
import { readHrz, readHrz3 } from './source/hrz.mjs';
import { readLgt } from './source/lgt.mjs';
import { compareSpeedSets, readSpeeds, speedsDirFor } from './source/speeds.mjs';

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
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(2, 13).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(args.help ? 0 : 1);
}

const game = args.game ?? process.env.SOURCE_TRACKS ?? DEFAULT_GAME;
const base = args.track;
const id = args.id ?? 'last-resort';
const out = args.out ?? `assets/maps/${id}.json`;
const colPath = path.join(game, `${base}.COL`);
const trkPath = path.join(game, `${base}.TRK`);
const hrzPath = path.join(game, `${base}.HRZ`);
// The 3D-accelerated horizon descriptor lives next to the geometry as `3Trxx.HRZ`.
const hrz3Path = hrz3PathFor(game, base);
// The light/depth-cue descriptor is also named from `%sTr%02d%s` with the literal `lgt` suffix.
const lgtPath = [path.join(game, `${base}.LGT`), path.join(game, `${base}.lgt`)].find((f) => fs.existsSync(f)) ?? null;
if (!fs.existsSync(colPath)) throw new Error(`No COL file: ${colPath}`);

const col = readCol(fs.readFileSync(colPath));
const collision = col.byId.get(15);
if (!collision) throw new Error(`${base}.COL has no collision block (15)`);
const records = collision.collision;

// The AI speeds dataset (`Tracks/Speeds/`), measured against this track's collision record count.
const speeds = readSpeeds(speedsDirFor(game), base, records.length);
// The B (mirrored) set only exists for some tracks; also look for a `TRnn` twin, because the
// shipped TR04 set turned out to be a copy of TR05's.
for (const twin of [`${base}B`, base === 'TR04' ? 'TR05' : base === 'TR05' ? 'TR04' : null]) {
  if (!twin) continue;
  const same = compareSpeedSets(speedsDirFor(game), base, twin);
  if (Object.values(same).some(Boolean)) {
    speeds.duplicateTrack = twin;
    speeds.duplicateOf = same;
    break;
  }
}

// A vector's norm is ~126 rather than a full 128; normalise by the record's own length so
// the frame stays orthonormal regardless of the encoder's rounding.
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const round = (v, p) => +v.toFixed(p);

const points = [], halfWidth = [], right = [], respawn = [];
let length = 0;
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const [x, y, z] = r.position;
  points.push([round(x, 3), round(y, 3), round(z, 3)]);
  halfWidth.push([round(r.leftBorder / 256, 2), round(r.rightBorder / 256, 2)]);
  const l = unit(r.right);
  right.push(round(l[0], 4), round(l[1], 4), round(l[2], 4));
  respawn.push(round((r.postCrash - r.leftBorder) / 256, 2));
  const n = records[(i + 1) % records.length];
  length += Math.hypot(n.position[0] - x, n.position[1] - y, n.position[2] - z);
}

const map = {
  schema: 1,
  kind: 'road',
  id,
  name: args.name ?? base,
  description: 'Coastal headland circuit: real elevation, banking and tight road limits.',
  laps: Number(args.laps ?? 3),
  step: round(length / points.length, 3),
  length: round(length, 2),
  source: { file: `${base}.COL`, block: 15, records: records.length },
  sky: fs.existsSync(hrzPath) ? readHrz(fs.readFileSync(hrzPath)) : null,
  sky3: hrz3Path ? readHrz3(fs.readFileSync(hrz3Path)) : null,
  light: lgtPath ? readLgt(fs.readFileSync(lgtPath)) : null,
  // The AI speeds dataset (`Tracks/Speeds/`), inventoried but not driven by: see
  // scripts/source/speeds.mjs for why the shipped TR04 set carries no TR04-specific data.
  speeds: speeds,
  points,
  halfWidth,
  right,
  respawn,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(map));

const range = (values) => [Math.min(...values), Math.max(...values)];
const widths = halfWidth.map(([l, r]) => l + r);
const gaps = points.map((p, i) => {
  const q = points[(i + 1) % points.length];
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
});
console.log(`[1] ${base} → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
console.log(`[2] route: ${records.length} points, ${map.length} m, step ${map.step} m, gap ${range(gaps).map(v => v.toFixed(2)).join('..')} m`);
console.log(`[3] elevation: ${range(points.map(p => p[1])).map(v => v.toFixed(1)).join('..')} m`);
console.log(`[4] corridor width: ${range(widths).map(v => v.toFixed(1)).join('..')} m (median ${widths.slice().sort((a, b) => a - b)[widths.length >> 1].toFixed(1)})`);
// The lateral axis is in the road plane; its vertical component is the banking tilt.
const tilt = right.filter((_, i) => i % 3 === 1).map((v) => Math.asin(v) * 180 / Math.PI);
console.log(`[5] banking (surface tilt): ${range(tilt.map(Math.abs)).map(v => v.toFixed(1)).join('..')} deg, ${tilt.filter(v => Math.abs(v) > 1).length} banked records`);
if (map.sky) {
  console.log(`[6] sky (software HRZ): flat ${map.sky.sky.join(',')} → horizon ${map.sky.horizonBase.join(',')}, radius ${map.sky.radius} m, pixmap base ${(map.sky.pixmapBase * 100).toFixed(0)}%`);
}
if (map.light) {
  const l = map.light;
  console.log(`[6c] light (${path.basename(lgtPath)}): depth cue ${l.depthCue.map(([d, i]) => `${d}m/${i}`).join(' ')}, palette ${l.palette.length} entries (${l.palette[0].join(',')} → ${l.palette[l.palette.length - 1].join(',')}), intensity ${l.minIntensity}..${l.maxIntensity}`);
}
if (map.sky3) {
  const s3 = map.sky3;
  console.log(`[6b] sky (3Dfx ${path.basename(hrz3Path)}): ring r ${s3.radius} m, earth ${s3.earthBase.join(',')} → ${s3.earthTop.join(',')}, sky ${s3.skyBaseSun.join(',')} (sun) / ${s3.skyBaseOpposite.join(',')} (opposite) → ${s3.skyTop.join(',')}, pixmap ${s3.pixmapBottom}..${s3.pixmapTop} m`);
}
if (speeds.files.ALN) {
  const perRecord = Object.entries(speeds.files).filter(([, v]) => v.perRecord).map(([k]) => k);
  const bits = Object.entries(speeds.files).map(([k, v]) => `${k} ${v.length}B`).join(' ');
  console.log(`[6d] speeds (${path.basename(speeds.dir)}/${base}.*): ${bits}`);
  console.log(`[6e] speeds one byte per collision record: ${perRecord.join(', ')}; ALN bytes non-zero ${speeds.files.ALN.length - speeds.files.ALN.zeroBytes}/${speeds.files.ALN.length}`);
  const dupes = Object.entries(speeds.duplicateOf ?? {}).filter(([, same]) => same).map(([k]) => k);
  if (dupes.length) console.log(`[6f] speeds byte-identical to ${speeds.duplicateTrack}.{${dupes.join(',')}} — the shipped ${base} set is a copy`);
}

if (args.evidence) {
  const evidence = { track: base, col: inspectCol(col), trk: inspectTrk(trkPath) };
  fs.mkdirSync(args.evidence, { recursive: true });
  fs.writeFileSync(path.join(args.evidence, `${base}-inventory.json`), JSON.stringify(evidence, null, 1));
  console.log(`[7] inventory → ${path.join(args.evidence, `${base}-inventory.json`)}`);
}

function inspectCol(col) {
  return {
    version: col.version,
    size: col.size,
    blocks: col.blocks.map((b) => ({ id: b.id, records: b.n, recSize: b.recSize })),
    textures: col.byId.get(2)?.textures.map((t) => t.texNumber),
  };
}

function inspectTrk(file) {
  if (!fs.existsSync(file)) return null;
  const trk = readTrk(fs.readFileSync(file));
  const count = (id) => trk.blocks.reduce((n, b) => n + (b.byId.get(id)?.n ?? 0), 0);
  return {
    superBlocks: trk.nSuperBlocks,
    blocks: trk.blocks.length,
    verts: trk.blocks.reduce((n, b) => n + b.verts.length, 0),
    polys: trk.blocks.reduce((n, b) => n + b.polys.length, 0),
    extra: { polyTypes: count(5), structures: count(8), structureRefs: count(18) + count(7) + count(19), vroad: count(13), lanes: count(9) },
  };
}
