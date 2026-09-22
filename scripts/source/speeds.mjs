// The source AI speeds dataset (`GameData/Tracks/Speeds/`), read by
// `aispeeds.c`. One set of files per track, plus a `B` set for the mirrored / reverse
// layout. The engine builds their names with the same `%sTr%02d%s.%s` pattern the geometry uses,
// so `TR04.ALN` is `Tr04` + `` + `.ALN` and `TR04B.ALN` is `Tr04` + `B` + `.ALN`.
//
// This dataset is *inventoried, not yet driven by*. What is measured here, and what stops it from
// feeding the AI today, is written down rather than guessed:
//
//  * `ALN` / `PLN` / `ASP` / `PSP` are as long as the track's collision record count (plus a short
//    lead-in), so they are per-record payloads. `ALN` is all-zero on seven of the eight tracks;
//    `PLN` is small integers (0..8..16) and `ASP` / `PSP` are dense (1..104).
//  * The shipped uncompressed `TR04.{ALN,PLN,ASP,PSP,SPD,SPL,SAL,SPE}` are **byte-identical to
//    `TR05.*`** and count 1877 records where TR04's own collision table has 1863. TR05's collision
//    table *is* 1877 records, so TR04's uncompressed Speeds set is a copy of TR05's. The
//    *compressed* `Q*` variants differ per track, so only the uncompressed set is duplicated.
//
// Because `ALN` is all zero, `PLN` counts 1877 records instead of TR04's 1863, and the uncompressed
// set is byte-identical to TR05's, the dataset contributes no TR04-specific AI line or speed. That
// is a negative result with numbers behind it, which is why it is recorded instead of wired in.

import fs from 'node:fs';
import path from 'node:path';

/** Extensions the engine ships per track in `Speeds/`, in the order the folder lists them. */
export const SPEED_EXTS = ['ALN', 'PLN', 'ASP', 'PSP', 'SPD', 'SPL', 'SAL', 'SPE', 'QAL', 'QAS', 'QPL', 'QPS'];

/** Sibling `Speeds/` folder of a `Tracks/SE` (or `Tracks/PC`) geometry directory. */
export const speedsDirFor = (gameDir) => path.join(path.dirname(gameDir), 'Speeds');

/**
 * Measure one speeds file: length, how it relates to the track's collision record count, and the
 * value range. `signed` reports the same bytes read two's-complement, which is how the small
 * `SPD`/`SPL` files should be read (they oscillate around zero).
 */
export function measureSpeedFile(buffer, records) {
  const values = [...buffer];
  const signed = values.map(v => (v > 127 ? v - 256 : v));
  return {
    length: buffer.length,
    /** Lead-in bytes in front of a payload as long as the track's record count; negative when shorter. */
    header: records == null ? null : buffer.length - records,
    zeroBytes: values.filter(v => v === 0).length,
    min: Math.min(...signed),
    max: Math.max(...signed),
    minUnsigned: Math.min(...values),
    maxUnsigned: Math.max(...values),
    /** This file's payload indexes the track's collision records 1:1. */
    perRecord: records != null && buffer.length - records >= 0 && buffer.length - records <= 16,
  };
}

/**
 * Read every speeds file present for one track. Returns `{ dir, track, files }`; missing files are
 * simply absent from `files` (the folder does not ship a full set for every track).
 * @param {string} speedsDir
 * @param {string} track `TR04`
 * @param {number|null} records collision record count from `TR04.COL` block 15
 */
export function readSpeeds(speedsDir, track, records = null) {
  const files = {};
  for (const ext of SPEED_EXTS) {
    const file = path.join(speedsDir, `${track}.${ext}`);
    if (fs.existsSync(file)) files[ext] = measureSpeedFile(fs.readFileSync(file), records);
  }
  return { dir: speedsDir, track, records, files };
}

/** True when two speeds files are byte-for-byte the same file, which pins a duplicated source set. */
export function sameFile(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Compare a track's speeds set with another track's. The shipped `TR04.*` set turns out to be a copy
 * of `TR05.*`; measuring it here keeps that from being silently re-guessed later.
 */
export function compareSpeedSets(speedsDir, a, b) {
  const out = {};
  for (const ext of SPEED_EXTS) {
    const fa = path.join(speedsDir, `${a}.${ext}`);
    const fb = path.join(speedsDir, `${b}.${ext}`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
    out[ext] = sameFile(fs.readFileSync(fa), fs.readFileSync(fb));
  }
  return out;
}
