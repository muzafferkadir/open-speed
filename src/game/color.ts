// Colour helpers shared by the sky and horizon painters. Nothing here touches three.js: the sky
// works on plain sRGB byte triples and converts at the boundary (canvas stops, vertex colours).

/** One colour channel per index: 0-255 sRGB, or 0-1 once the value has been converted. */
export type Rgb = [number, number, number];

/** Channel-wise blend of two colours, clamped: `t = 0` gives `a`, `t = 1` gives `b`. */
export function blendRgb(a: Rgb, b: Rgb, t: number): Rgb {
 const k = Math.min(1, Math.max(0, t));
 return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** One sRGB byte triple (0..255) as a linear-space triple (0..1), the space three.js vertex colours
 *  live in. The sky texture is sRGB, so an unconverted ring renders too bright and seams against it. */
export const srgbToLinear = (c: Rgb): Rgb => c.map((v) => {
 const s = Math.min(Math.max(v, 0), 255) / 255;
 return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}) as Rgb;
