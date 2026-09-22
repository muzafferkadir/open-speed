// Source track data lives in two sibling folders:
//   Tracks/SE  — geometry (TRK/COL/LGT/HRZ) plus the low-res software texture set
//   Tracks/PC  — the same 428 textures at 4-16x the resolution (Glide / 3D-accelerated mode)
// Both texture archives index identically (COL extra-block 2 texNumber 8..427), so the
// polygon -> texture mapping is unchanged when the high-res set is swapped in.
//
// Each folder also ships `<track>0M.QFS`, the horizontally-mirrored texture set (measured: of 428
// textures, 409 are byte-identical and 19 are mirrored banner/sign art — `HOTEL`, `EL CHANGO`,
// `TACO`, `STEVE'S BAR`; the `LEH` start banner reads `HEL` in `0M`). The loader `sub_433e80`
// (`LoadInitialTextures`, exe 0x433e80) picks it purely on the runtime mirror flag `0x4dd30c`:
// nonzero -> `<ArtRes>/<track>0m.qfs`, zero -> `<track>0.qfs`. It is a menu toggle, not a per-track
// property — all eight `TRxx.HRZ` files carry `mirror 1`, so the HRZ field cannot gate it. This
// conversion draws the track unmirrored (the original's default path, flag 0), so it reads
// `<track>0.QFS` and the `M` set is not a gap.
//
// This is the only place the folder choice is made. Everything that needs a texture file
// goes through `textureDirFor` so the extractor and the offline renderer agree.

import fs from 'node:fs';
import path from 'node:path';

/** Resolution order: explicit `--tex-dir`, then the sibling `PC` high-res set, then the geometry dir. */
export function textureDirFor(gameDir, base, explicit) {
  if (explicit) return explicit;
  const sibling = path.join(path.dirname(gameDir), 'PC');
  if (fs.existsSync(path.join(sibling, `${base}0.QFS`))) return sibling;
  return gameDir;
}

/** Absolute path of the track's primary texture archive for a given texture directory. */
export const texturePathFor = (texDir, base) => path.join(texDir, `${base}0.QFS`);

/**
 * The 3D-accelerated horizon descriptor (`3Trxx.HRZ`) sits with the geometry, not with the texture
 * sets: it is absent from the `PC` folder. Returns null when the track has no 3Dfx horizon.
 */
export function hrz3PathFor(gameDir, base) {
  for (const dir of [gameDir, path.join(path.dirname(gameDir), 'SE')])
    for (const name of [`3${base}.HRZ`, `3${base}.hrz`]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    }
  return null;
}
