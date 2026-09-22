// Track light/depth-cue descriptor (`LGT`).
//
// The engine builds the track filename as `%sTr%02d%s` with the literal suffix `lgt`
// i.e. `Tr04lgt`.
// The file is plain ASCII with `/* ... */` field comments, the same house style as `TRxx.HRZ`.
//
// Every track ships a byte-identical copy (md5 776928c0… for TR00/TR02/TR03/TR04/TR05/TR06/
// TR07/TR08), so this is a shared engine default rather than per-track art. The values are still
// the original ones, which is why the renderer reads them instead of inventing a fog colour.
//
// Layout, in file order:
//
//   /* Depth cueing definition */     4 × (distance, light)   distance 0..250 m, light 0..15
//   /* Light palettes */              16 × (r, g, b)          the engine's shading ramp
//   /* Maximum and minumum intensity */  (min, max)
//   /* sfx light color */             type, then 2 × (r, g, b)

const strip = (line) => line.replace(/\/\*.*?\*\//g, '').trim();
const numbers = (line) => (line.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * Parse an `LGT` file into its fields.
 *
 * Values are taken in file order and every group's width is validated, so a reordered or
 * truncated file fails loudly instead of silently producing a shifted palette.
 * @param {Buffer|string} file
 */
export function readLgt(file) {
  const text = Buffer.isBuffer(file) ? file.toString('latin1') : String(file);
  const lines = text.split(/\r?\n/);
  // Data lines only: the comments name the sections, blank lines separate them.
  const data = lines.map(strip).filter((l) => l !== '');
  const sections = lines.map(strip).filter((l) => l.startsWith('/*') === false && l === '');
  void sections;

  let at = 0;
  const take = (n, label) => {
    if (at >= data.length) throw new Error(`LGT: no data left for "${label}"`);
    const v = numbers(data[at++]);
    if (v.length !== n) throw new Error(`LGT: "${label}" expects ${n} numbers, got ${v.length}`);
    return v;
  };

  const depthCue = Array.from({ length: 4 }, () => take(2, 'depth cue'));
  const palette = Array.from({ length: 16 }, () => take(3, 'light palette'));
  const intensity = take(2, 'min/max intensity');
  const sfxType = take(1, 'sfx light type');
  const sfxLight = [take(3, 'sfx light 0'), take(3, 'sfx light 1')];
  if (at !== data.length) throw new Error(`LGT: ${data.length - at} unread data lines`);

  // The depth-cue distances must ascend, or the ramp is not a ramp.
  for (let i = 1; i < depthCue.length; i++)
    if (depthCue[i][0] <= depthCue[i - 1][0]) throw new Error('LGT: depth-cue distances are not ascending');

  return {
    /** [distance m, light] pairs; the renderer fades geometry between them. */
    depthCue,
    /** 16-entry RGB shading ramp, black to white by default. */
    palette,
    minIntensity: intensity[0],
    maxIntensity: intensity[1],
    sfxLightType: sfxType[0],
    sfxLight,
  };
}
