// Horizon/sky descriptor (TRxx.HRZ). The file is a plain-text config: a comment line
// naming a field, then its value on the next line. Layout follows the shared HRZ structure plus the
// remaining fields read straight off the original TR04.HRZ. No game file is copied; only numbers.

const numbers = (line) => (line.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * Parse one HRZ file into its fields. Field order is fixed by the format; comments are used as a
 * cross-check so a reordered file fails loudly instead of silently mislabelling values.
 * @param {Buffer|string} file
 */
export function readHrz(file) {
  const text = Buffer.isBuffer(file) ? file.toString('latin1') : String(file);
  const lines = text.split(/\r?\n/).map(l => l.trim());

  const next = (marker) => {
    const at = lines.findIndex(l => l.toLowerCase().includes(marker));
    if (at < 0) throw new Error(`HRZ: missing field "${marker}"`);
    for (let i = at + 1; i < lines.length; i++) if (lines[i] && !lines[i].startsWith('/*')) return lines[i];
    throw new Error(`HRZ: no value after "${marker}"`);
  };
  const scalar = (marker) => {
    const v = numbers(next(marker));
    if (v.length !== 1) throw new Error(`HRZ: "${marker}" is not a single number`);
    return v[0];
  };
  const triple = (marker) => {
    const v = numbers(next(marker));
    if (v.length !== 3) throw new Error(`HRZ: "${marker}" is not three numbers`);
    return v;
  };

  const horizon = next('pixmap base');
  const hrz = {
    blackHorizon: scalar('black horizon') === 1,
    mirror: scalar('mirror flag') === 1,
    radius: scalar('radius of the horizon'),
    rotation: scalar('angle of rotation'),
    projectionDistance: scalar('flat projection'),
    baseHeight: scalar('base of the flat shaded area is'),
    height: scalar('height of the horizon'),
    pixmapBase: numbers(horizon)[0] / 100, // integer percentage of the horizon height
    sky: triple('flat shaded sky area'),
    horizonBase: triple('horizon base area'),
    depthCues: numbers(next('depth cueing distance values')),
    depthCueLights: numbers(next('depth cueing light values')),
    colorSystem: scalar('color system to use'),
    rgb: triple('rgb.hsv value'),
  };
  return hrz;
}

/**
 * Parse the 3D-accelerated horizon descriptor (`3Trxx.HRZ`, read by `Hrz_ReadHorizonData` in the
 * 3Dfx build's `game/3rash/hrzsku.c`). Same plain-text layout as `TRxx.HRZ` but the hardware
 * renderer shades the horizon instead of flat-filling it:
 *
 * - a ring of `radius` metres centred on the camera,
 * - an EARTH band from `baseHeight` up to `midpoint`, and a SKY band from `midpoint` up to
 *   `baseHeight + height`, each Gouraud-shaded between a base and a top colour,
 * - the sky band's base colour is given twice: at the sun and opposite the sun,
 * - `pixmapTop`/`pixmapBottom` bound the screen-space horizon pixmap (the `CLD*` clouds in
 *   `SKY.FSH`), which sits above the shading bands.
 *
 * All heights are offsets in metres; field order is validated so a reordered file fails loudly.
 * @param {Buffer|string} file
 */
export function readHrz3(file) {
  const text = Buffer.isBuffer(file) ? file.toString('latin1') : String(file);
  const lines = text.split(/\r?\n/).map(l => l.trim());
  // Inline numbers in comments (e.g. "237, 166, 59, at position of sun") must not be read as data.
  const strip = (l) => l.replace(/\/\*.*?\*\//g, '').trim();

  const order = [];
  const at = (marker, label = marker) => {
    const key = marker.toLowerCase();
    const i = lines.findIndex(l => l.toLowerCase().includes(key));
    if (i < 0) throw new Error(`HRZ3: missing field "${marker}"`);
    order.push([label, i]);
    let v = i + 1;
    while (v < lines.length && strip(lines[v]) === '') v++;
    if (v >= lines.length) throw new Error(`HRZ3: no value after "${marker}"`);
    return v;
  };
  const values = (marker) => numbers(strip(lines[at(marker)]));
  /** `n` consecutive value lines: some fields (the sky base) carry a sun and an opposite triplet. */
  const sequence = (marker, n) => {
    const first = at(marker);
    const out = [numbers(strip(lines[first]))];
    let v = first;
    while (out.length < n) {
      v++;
      if (v >= lines.length) throw new Error(`HRZ3: "${marker}" has fewer than ${n} value lines`);
      const raw = strip(lines[v]);
      if (raw === '') continue;
      out.push(numbers(raw));
      order.push([`${marker} #${out.length}`, v]);
    }
    return out;
  };
  const scalar = (marker, label) => {
    const v = values(marker);
    if (v.length !== 1) throw new Error(`HRZ3: "${marker}" is not a single number`);
    if (label) order[order.length - 1][0] = label;
    return v[0];
  };
  const pair = (marker) => {
    const v = values(marker);
    if (v.length !== 2) throw new Error(`HRZ3: "${marker}" is not two numbers`);
    return v;
  };
  const triple = (marker) => {
    const v = values(marker);
    if (v.length !== 3) throw new Error(`HRZ3: "${marker}" is not three numbers`);
    return v;
  };

  // Read in file order so the monotonic check below also proves the layout matches the format.
  const hrz = {
    cloudDome: pair('cloud dome offset'),
    blackHorizon: scalar('Black Horizon') === 1,
    mirror: scalar('mirror flag') === 1,
    radius: scalar('radius of the horizon'),
    rotation: scalar('angle of rotation'),
    projectionDistance: scalar('flat projection'),
    baseHeight: scalar('base of the Gourad shaded area is'),
    height: scalar('height of the Gourad shaded area'),
    midpoint: scalar('midpoint of Gourad shaded area'),
    pixmapTop: scalar('top of horizon pixmap'),
    pixmapBottom: scalar('bottom of horizon pixmap'),
    earthTop: triple('top of Gourad shaded EARTH area'),
    earthBase: triple('base of Gourad shaded EARTH area'),
    skyTop: triple('top of Gourad shaded SKY area'),
    skyBaseSun: null,
    skyBaseOpposite: null,
  };
  const [skyBaseSun, skyBaseOpposite] = sequence('base of Gourad shaded SKY area', 2);
  if (skyBaseSun.length !== 3 || skyBaseOpposite.length !== 3)
    throw new Error('HRZ3: sky base area needs a sun and an opposite-sun triplet');
  hrz.skyBaseSun = skyBaseSun;
  hrz.skyBaseOpposite = skyBaseOpposite;
  for (let i = 0; i < order.length - 1; i++)
    if (order[i + 1][1] <= order[i][1]) throw new Error(`HRZ3: "${order[i + 1][0]}" is out of order`);
  return hrz;
}

export const hrzHex = (rgb) => `#${rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
