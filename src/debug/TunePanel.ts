import type { Postprocessing } from '../game/Postprocessing.js';
import type { RenderStyle, Style, StyleTuning } from '../game/RenderStyle.js';

/**
 * A slider panel for the look, so the values are chosen by eye rather than guessed in a commit.
 *
 * Debug only (`?tune`, or `?debug` and the T key). Everything applies as it is dragged, and
 * "kopyala" puts the whole set on the clipboard - which is how a setting that looked right on
 * screen gets back into the defaults.
 */

type Knob = { key: string; label: string; min: number; max: number; step: number };

/** The grade and the effects, in the order they read top to bottom. */
const POST: Knob[] = [
 { key: 'saturation', label: 'doygunluk', min: 0, max: 2, step: 0.01 },
 { key: 'contrast', label: 'kontrast', min: 0.5, max: 2, step: 0.01 },
 { key: 'vignette', label: 'vignette', min: 0, max: 1, step: 0.01 },
 { key: 'grain', label: 'grain', min: 0, max: 0.15, step: 0.002 },
 { key: 'fringe', label: 'kromatik sapma', min: 0, max: 10, step: 0.1 },
 { key: 'bloom', label: 'bloom', min: 0, max: 1.5, step: 0.01 },
 { key: 'bloomRadius', label: 'bloom yarıçap', min: 0, max: 1.5, step: 0.01 },
 { key: 'bloomThreshold', label: 'bloom eşik', min: 0, max: 1.5, step: 0.01 },
 { key: 'ao', label: 'AO karışım', min: 0, max: 1, step: 0.01 },
 { key: 'aoScale', label: 'AO şiddet', min: 0, max: 3, step: 0.02 },
 { key: 'aoRadius', label: 'AO yarıçap', min: 0.1, max: 4, step: 0.05 },
];

/** The shading style's own knobs. */
const STYLE: (Knob & { key: keyof StyleTuning })[] = [
 { key: 'outline', label: 'kontur kalınlığı', min: 0, max: 0.6, step: 0.005 },
 { key: 'steps', label: 'toon kademe', min: 2, max: 8, step: 1 },
 { key: 'floor', label: 'toon taban', min: 0, max: 0.8, step: 0.01 },
];

const CSS = `
.tune{position:fixed;top:12px;left:12px;z-index:60;width:250px;max-height:88vh;overflow:auto;
 background:#0e1412ee;border:1px solid #2f4a3f;border-radius:10px;padding:10px 12px;
 font:11px/1.5 ui-monospace,Menlo,monospace;color:#cfe6d8}
.tune h4{margin:6px 0 4px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#7fbf9b}
.tune label{display:flex;align-items:center;gap:6px;margin:2px 0}
.tune label span{flex:1}
.tune label b{font-weight:500;width:44px;text-align:right;color:#eafff2}
.tune input[type=range]{width:96px;accent-color:#7de8c3}
.tune select,.tune button{width:100%;margin:3px 0;background:#16211c;color:#cfe6d8;
 border:1px solid #2f4a3f;border-radius:6px;padding:4px 6px;font:inherit}
.tune button{cursor:pointer}
`;

export function mountTunePanel(
 post: Postprocessing, style: RenderStyle,
 styles: readonly Style[], looks: readonly string[],
 tones: readonly string[], setTone: (tone: string) => void,
): void {
 const sheet = document.createElement('style');
 sheet.textContent = CSS;
 document.head.append(sheet);

 const panel = document.createElement('div');
 panel.className = 'tune';
 const heading = (text: string) => { const h = document.createElement('h4'); h.textContent = text; panel.append(h); };

 heading('stil');
 const styleBox = document.createElement('select');
 for (const name of styles) styleBox.append(new Option(name, name));
 styleBox.onchange = () => apply(styleBox.value as Style);
 panel.append(styleBox);

 heading('grade filtresi');
 const lookBox = document.createElement('select');
 for (const name of looks) lookBox.append(new Option(name, name));
 lookBox.onchange = () => post.setLook(lookBox.value);
 panel.append(lookBox);

 const slider = (knob: Knob, read: () => number, write: (value: number) => void) => {
  const row = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = knob.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(knob.min); input.max = String(knob.max); input.step = String(knob.step);
  input.value = String(read());
  const value = document.createElement('b');
  value.textContent = input.value;
  input.oninput = () => { write(Number(input.value)); value.textContent = input.value; };
  row.append(name, input, value);
  panel.append(row);
 };

 heading('ton eşlemesi');
 const toneBox = document.createElement('select');
 for (const name of tones) toneBox.append(new Option(name, name));
 toneBox.onchange = () => setTone(toneBox.value);
 panel.append(toneBox);

 heading('şekillendirme');
 for (const knob of STYLE) slider(knob, () => style.tuning[knob.key], v => style.tune(knob.key, v));

 heading('post');
 const readings = post.readings();
 for (const knob of POST) slider(knob, () => readings[knob.key] ?? 0, v => post.tune(knob.key, v));

 const copy = document.createElement('button');
 copy.textContent = 'değerleri kopyala';
 copy.onclick = async () => {
  const text = JSON.stringify({ style: styleBox.value, look: lookBox.value, tone: toneBox.value, ...style.tuning, ...post.readings() }, null, 1);
  try { await navigator.clipboard.writeText(text); copy.textContent = 'kopyalandı'; }
  catch { copy.textContent = 'panoya yazılamadı, konsolda'; }
  console.log(text);
  setTimeout(() => { copy.textContent = 'değerleri kopyala'; }, 1500);
 };
 panel.append(copy);
 document.body.append(panel);

 let applyStyle: (name: Style) => void = () => {};
 function apply(name: Style) { applyStyle(name); }
 // The game owns the scene, so the panel asks it to restyle rather than reaching in itself.
 (window as unknown as { __tuneApply?: (fn: (name: Style) => void) => void }).__tuneApply = fn => { applyStyle = fn; };
}
