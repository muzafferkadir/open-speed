// Turns a pixel in a rendered frame into a place in the world.
//
// Usage: node scripts/verify/place.mjs --from x,y,z --at x,y,z --pixel 640,400 [--pixel ...]
//        [--map last-resort] [--out build/review/place.png] [--size 1280x720] [--session name]
//
// Scenery is placed by coordinate, and a coordinate guessed off a screenshot is a coordinate
// guessed wrong - three set pieces went into a hillside that way. This renders the frame with a
// pixel grid drawn over it, then reports, for each pixel named, what is under it: the world point,
// the surface normal, how the ground lies there, and where that is along the route. The output is
// meant to be pasted into a landmark.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const all = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const triple = name => {
 const value = (opt(name, '') ?? '').split(',').map(Number);
 if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} needs x,y,z`);
 return value;
};
const from = triple('--from');
const at = triple('--at');
const map = opt('--map', 'last-resort');
const out = resolve(root, opt('--out', 'build/review/place.png'));
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const session = opt('--session', `place-${process.pid}`);
const pixels = all('--pixel').map(p => p.split(',').map(Number));

const dist = join(root, 'build/verify-dist/index.html');
if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && npm run verify:file-dist');

const ab = (...a) => {
 try { return execFileSync('agent-browser', [a[0], '--session', session, ...a.slice(1)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
 catch (e) { throw new Error(`agent-browser ${a[0]} failed: ${e.stderr || e.message}`); }
};
const evalJs = js => ab('eval', js).trim();
const unwrap = raw => { const once = JSON.parse(raw); return typeof once === 'string' ? JSON.parse(once) : once; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A labelled grid over the frame, so a pixel can be read off the PNG and named back. */
const GRID = (step) => `(()=>{
 document.getElementById('place-grid')?.remove();
 const canvas = document.createElement('canvas');
 canvas.id = 'place-grid';
 canvas.width = innerWidth; canvas.height = innerHeight;
 Object.assign(canvas.style, { position: 'fixed', inset: '0', zIndex: '90', pointerEvents: 'none' });
 const ctx = canvas.getContext('2d');
 ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.fillStyle = 'rgba(255,255,255,.75)';
 ctx.font = '10px ui-monospace,monospace'; ctx.lineWidth = 1;
 for (let x = 0; x <= canvas.width; x += ${step}) {
  ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, canvas.height); ctx.stroke();
  ctx.fillText(String(x), x + 3, 11);
 }
 for (let y = 0; y <= canvas.height; y += ${step}) {
  ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(canvas.width, y + .5); ctx.stroke();
  ctx.fillText(String(y), 3, y + 12);
 }
 document.body.append(canvas);
 return 'grid';
})()`;

try {
 ab('open', `file://${dist}?debug`, '--init-script', join(root, 'scripts/verify/file-origin-shim.js'),
  '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio');
 await sleep(4000);
 ab('set', 'viewport', String(width), String(height));
 evalJs(`(()=>{window.__openSpeed.settings.set('map','${map}');return 'map'})()`);
 ab('eval', 'location.reload()');
 await sleep(10000);
 evalJs(`(()=>{const g=window.__openSpeed;g.startDrive();g.paused=true;g.race=null;return 'drive'})()`);
 for (let waited = 0; waited < 20000; waited += 1000) {
  await sleep(1000);
  if (evalJs(`String(!!window.__openSpeed.drive)`) === 'true') break;
 }
 await sleep(1500);
 evalJs(`(()=>{const g=window.__openSpeed;
  g.renderer.setAnimationLoop(null);
  const camera=g.cameraRig.camera;
  camera.position.set(${from.join(',')});
  camera.lookAt(${at.join(',')});
  camera.updateMatrixWorld(true);
  g.composer.render(0.016, 0);
  return 'rendered'})()`);
 await sleep(400);
 evalJs(GRID(100));
 await sleep(200);
 ab('screenshot', out);
 console.log(`saved ${out}`);
 for (const [px, py] of pixels) {
  const ndcX = (px / width) * 2 - 1, ndcY = 1 - (py / height) * 2;
  const report = unwrap(evalJs(`(()=>{const g=window.__openSpeed;
   const hits = window.__pick(${ndcX}, ${ndcY});
   if (!hits.length) return JSON.stringify({ miss: true });
   const hit = hits[0];
   const [x, y, z] = hit.point;
   const w = g.world;
   const ground = w.heightAt(x, z);
   const at = w.locate ? w.locate(x, z) : null;
   return JSON.stringify({ name: hit.name, parent: hit.parent, point: hit.point, normal: hit.normal,
    ground: Math.round(ground * 10) / 10,
    s: at ? Math.round(at.s) : null, lateral: at ? Math.round(at.lateral * 10) / 10 : null });})()`));
  if (report.miss) { console.log(`${px},${py}  nothing there`); continue; }
  const [x, y, z] = report.point;
  console.log(`${px},${py}  ${report.parent}/${report.name}`);
  console.log(`  x: ${x}, y: ${y}, z: ${z}   ground ${report.ground}   s ${report.s} lateral ${report.lateral}`);
  console.log(`  normal ${report.normal.join(', ')}`);
 }
} finally {
 try { ab('close'); } catch { /* the session is already gone */ }
}
