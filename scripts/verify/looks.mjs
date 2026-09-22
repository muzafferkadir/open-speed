// One frame of a map, rendered through every style it can be drawn in.
//
// Usage: node scripts/verify/looks.mjs --from x,y,z --at x,y,z [--map last-resort] [--out dir]
//        [--size 1280x720] [--session name] [--kind style|look]
//
// `--kind style` walks the shading styles (RenderStyle.STYLES): the materials themselves change,
// so the lighting does. `--kind look` walks the grade styles (Postprocessing.LOOKS), which are
// filters over the finished picture. Default is style.
//
// Same camera, same frame, one PNG per look, so the styles can be compared rather than described.
// Like freecam.mjs it stops the render loop and renders single frames, so nothing moves between
// them. Headless and muted, in its own session.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const triple = name => {
 const value = (opt(name, '') ?? '').split(',').map(Number);
 if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} needs x,y,z`);
 return value;
};
const from = triple('--from');
const at = triple('--at');
const map = opt('--map', 'last-resort');
const out = resolve(root, opt('--out', 'build/review/looks'));
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const session = opt('--session', `looks-${process.pid}`);

const dist = join(root, 'build/verify-dist/index.html');
if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && npm run verify:file-dist');
mkdirSync(out, { recursive: true });

const ab = (...a) => {
 try { return execFileSync('agent-browser', [a[0], '--session', session, ...a.slice(1)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
 catch (e) { throw new Error(`agent-browser ${a[0]} failed: ${e.stderr || e.message}`); }
};
const evalJs = js => ab('eval', js).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
 // agent-browser hands back the value already JSON encoded, so the payload arrives double wrapped.
 const unwrap = raw => { const once = JSON.parse(raw); return typeof once === 'string' ? JSON.parse(once) : once; };
 const kind = opt('--kind', 'style');
 const names = unwrap(evalJs(`JSON.stringify(window.__openSpeed.${kind === 'look' ? 'looks' : 'styles'})`));
 for (const look of names) {
  evalJs(`(()=>{const g=window.__openSpeed;
   g.renderer.setAnimationLoop(null);
   ${kind === 'look' ? `g.composer.setLook('${look}');` : `g.setStyle('${look}');`}
   const camera=g.cameraRig.camera;
   camera.position.set(${from.join(',')});
   camera.lookAt(${at.join(',')});
   camera.updateMatrixWorld(true);
   g.composer.render(0.016, 0);
   return 'ok'})()`);
  await sleep(500);
  ab('screenshot', join(out, `${map}-${look}.png`));
  console.log(`${look} -> ${join(out, `${map}-${look}.png`)}`);
 }
} finally {
 try { ab('close'); } catch { /* the session is already gone */ }
}
