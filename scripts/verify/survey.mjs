// Route survey: capture N reproducible frames along the Last Resort spine in one browser session.
//
// Usage: node scripts/verify/survey.mjs <prefix> [--stations 16] [--session lr-survey]
//        [--url http://127.0.0.1:5173/] [--height 6] [--back 16] [--map last-resort]
//
// Drives the debug camera along world.circuit at evenly spaced stations, looking along the route.
// Uses a NAMED session, never closes other sessions, never starts a server.
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const prefix = resolve(root, args[0] ?? 'build/review/survey');
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const stations = Number(opt('--stations', 16));
const session = opt('--session', 'lr-survey');
const url = opt('--url', `file://${resolve(root, 'build/verify-dist/index.html')}`);
const map = opt('--map', 'last-resort');
const height = Number(opt('--height', 6));
const back = Number(opt('--back', 16));
const extra = opt('--spawn', '');

const ab = (...a) => execFileSync('agent-browser', ['--session', session, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const evalJs = (js) => { try { return ab('eval', js).trim(); } catch (e) { return `ERR ${e.message.split('\n')[0]}`; } };
// The browser is released however this script ends. Without it a thrown assertion leaves a
// headless Chrome behind, and a few of those burn a core each until someone notices the fan.
process.on('exit', () => { try { ab('close'); } catch { /* already gone */ } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A file:// run needs the origin shim that rebases root-absolute URLs; that way a survey needs
// no dev server at all (default build/verify-dist, see make-file-dist.mjs).
const shim = resolve(root, 'scripts/verify/file-origin-shim.js');
const initArgs = url.startsWith('file://') ? ['--init-script', shim] : [];
ab('open', `${url}?debug`, ...initArgs, '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio');
await sleep(6000);
// Force the map before drive so the world that is built is Last Resort.
evalJs(`(()=>{const g=window.__openSpeed; if(g.mapId!=='${map}'){g.settings.set('map','${map}'); return 'reload'} return 'same'})()`);
ab('eval', 'location.reload()');
await sleep(20000);
// Reload can still be mid-load for the large GLB; poll for the handle.
for (let k = 0; k < 15; k++) {
  const ok = evalJs(`(()=>{const g=window.__openSpeed; return g && g.world && g.world.circuit ? 'yes' : 'no'})()`);
  if (ok.includes('yes')) break;
  await sleep(2000);
}
const check = evalJs(`(()=>{const g=window.__openSpeed; return g.mapId+' / '+g.world.constructor.name})()`);
console.log('map:', check);

evalJs(`(()=>{const g=window.__openSpeed; g.startDrive(); g.paused=true; g.input.clear(); g.race=null; return 'drive'})()`);

const count = Number(evalJs(`(()=>String(window.__openSpeed.world.circuit.length))()`).replace(/[^0-9]/g, '') || 0);
console.log('circuit points:', count);
for (let i = 0; i < stations; i++) {
  const idx = Math.floor((i / stations) * count);
  evalJs(`(()=>{const g=window.__openSpeed; const c=g.world.circuit; const n=c.length; const i=(${idx})%n; const a=c[i], b=c[(i+4)%n];
    const yaw=Math.atan2(-(b[0]-a[0]), -(b[1]-a[1]));
    g.physics.reset(a[0], a[1], yaw); g.current=g.previous=g.physics.state;
    return 'ok'})()`);
  await sleep(450);
  ab('screenshot', `${prefix}-s${String(i).padStart(2, '0')}.png`);
}
console.log('done');
ab('close');
