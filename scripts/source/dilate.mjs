// Kill the magenta fringe on cut-out sprites.
//
// The original palette has no alpha, so the sprite background is pure magenta and the decoder maps
// those texels to alpha 0 (scripts/source/fsh.mjs). The RGB stays magenta though, and the GPU
// bilinear-filters RGB and alpha together: at a sprite edge a visible fragment (alpha > alphaTest)
// can pick up magenta from a transparent neighbour and draw a pink rim.
//
// Fix at export time only: give every transparent texel the colour of the nearest opaque texel
// (edge extend / dilate). Filtered edge fragments then blend the sprite's own colour, not magenta.
// The decoder itself stays literal and keeps source RGB.

/** Replace the colour of every alpha-0 texel with the nearest opaque texel's colour. */
export function dilateKeyed(rgba, width, height) {
  const size = width * height;
  const out = Uint8Array.from(rgba);
  const seen = new Uint8Array(size);
  let queue = [];
  for (let i = 0; i < size; i++) if (rgba[i * 4 + 3] !== 0) { seen[i] = 1; }
  queue = [];
  for (let i = 0; i < size; i++) if (seen[i]) queue.push(i);
  if (!queue.length) return out; // fully transparent texture: nothing to extend from
  // Multi-source BFS over 4-neighbours: each transparent texel adopts its nearest source colour.
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % width, y = (i / width) | 0;
    const r = out[i * 4], g = out[i * 4 + 1], b = out[i * 4 + 2];
    for (const n of neighbours(x, y, width, height)) {
      if (seen[n]) continue;
      seen[n] = 1;
      out[n * 4] = r; out[n * 4 + 1] = g; out[n * 4 + 2] = b; // alpha already 0, keep it
      queue.push(n);
    }
  }
  return out;
}

function* neighbours(x, y, width, height) {
  if (x > 0) yield y * width + x - 1;
  if (x < width - 1) yield y * width + x + 1;
  if (y > 0) yield (y - 1) * width + x;
  if (y < height - 1) yield (y + 1) * width + x;
}
