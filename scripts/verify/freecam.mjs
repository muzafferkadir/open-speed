// One rendered frame from anywhere in a built map, with no car in the way.
//
// Usage: node scripts/verify/freecam.mjs <out.png> --from x,y,z --at x,y,z
//        [--map last-resort] [--size 1280x720] [--session name] [--url http://...]
//
// The other shot scripts all frame the chase camera, which is tied to the car: you can only look
// at what the car can reach, and the car is kept out of water and off cliffs. This one stops the
// render loop, puts the camera where it is told, renders a single frame through the same
// post-processing stack and shoots it - which is how the sea, a distant landmark or the far side
// of a valley get checked at all.
//
// Loads build/verify-dist over file:// with the origin shim, unless --url says otherwise. Chrome
// runs headless and muted, in its own named session.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = args.find(a => !a.startsWith('--') && a.endsWith('.png'))
 ?? join(root, 'build/review/freecam.png');
const triple = (name, fallback) => {
 const value = (opt(name, fallback) ?? '').split(',').map(Number);
 if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} needs x,y,z`);
 return value;
};
const from = triple('--from');
const at = triple('--at');
const map = opt('--map', 'last-resort');
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const session = opt('--session', `freecam-${process.pid}`);

const dist = join(root, 'build/verify-dist/index.html');
if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && npm run verify:file-dist');
const url = opt('--url', `file://${dist}`);
const shim = join(root, 'scripts/verify/file-origin-shim.js');

const ab = (...a) => {
 try { return execFileSync('agent-browser', [a[0], '--session', session, ...a.slice(1)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
 catch (e) { throw new Error(`agent-browser ${a[0]} failed: ${e.stderr || e.message}`); }
};
const evalJs = js => ab('eval', js).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
 ab('open', `${url}?debug`, ...(url.startsWith('file://') ? ['--init-script', shim] : []),
  '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio');
 await sleep(4000);
 ab('set', 'viewport', String(width), String(height));
 evalJs(`(()=>{window.__openSpeed.settings.set('map','${map}');return 'map'})()`);
 ab('eval', 'location.reload()');
 await sleep(10000);
 // The drive stage carries the scene; without it there is nothing to point a camera at.
 evalJs(`(()=>{const g=window.__openSpeed;g.startDrive();g.paused=true;g.race=null;return 'drive'})()`);
 for (let waited = 0; waited < 20000; waited += 1000) {
  await sleep(1000);
  if (evalJs(`String(!!window.__openSpeed.drive)`) === 'true') break;
 }
 await sleep(1500);
 console.log(evalJs(`(()=>{const g=window.__openSpeed;
  g.renderer.setAnimationLoop(null);
  const camera=g.cameraRig.camera;
  camera.position.set(${from.join(',')});
  camera.lookAt(${at.join(',')});
  camera.updateMatrixWorld(true);
  g.composer.render(0.016, 0);
  return 'rendered ${map} from ${from.join(',')}'})()`));
 await sleep(600);
 ab('screenshot', out);
 console.log(`saved ${out}`);
} finally {
 try { ab('close'); } catch { /* the session is already gone */ }
}
