// Headless screenshot of the Last Resort route from the built app, no HTTP server.
//
// Usage: node scripts/verify/headless-shot.mjs <out.png> [--map last-resort] [--drive ms] [--race] [--spawn x,z,yawDeg] [--free]
//
// The app is loaded from build/verify-dist (see make-file-dist.mjs) with the file:// shim that
// rebases root-absolute URLs and re-implements XHR on fetch. Chrome runs headless; nothing is shown.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const out = args[0] ?? join(root, 'build/review/headless.png');
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const map = opt('--map', 'last-resort');
const driveMs = Number(opt('--drive', 0));
const race = args.includes('--race');
const free = args.includes('--free');
const spawn = opt('--spawn', '');

const dist = join(root, 'build/verify-dist/index.html');
if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && node scripts/verify/make-file-dist.mjs');
const shim = join(root, 'scripts/verify/file-origin-shim.js');

// One isolated session per process: a shared browser would mix this run's page with another's,
// and `close --all` would tear down sessions this script does not own.
const session = `shot-${process.pid}`;
const ab = (...a) => {
  try { return execFileSync('agent-browser', [a[0], '--session', session, ...a.slice(1)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`agent-browser ${a[0]} failed: ${e.stderr || e.message}`); }
};
// The browser is released however this script ends. Without it a thrown assertion leaves a
// headless Chrome behind, and a few of those burn a core each until someone notices the fan.
process.on('exit', () => { try { ab('close'); } catch { /* already gone */ } });

const evalJs = (js) => ab('eval', js).trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ab('open', `file://${dist}?debug${spawn ? `&spawn=${spawn}` : ''}`, '--init-script', shim,
  '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio');
await sleep(3500);

// The map switch persists the setting and reloads; reload once so the debug handle is reattached.
evalJs(`(()=>{const g=window.__openSpeed; g.settings.set('map','${map}'); return 'map set'})()`);
ab('eval', 'location.reload()');
await sleep(4000);

if (race) {
  // START tab -> START RACE button, addressed by text so it survives layout changes.
  evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^start$/i.test(b.textContent.trim())); if(!b) return 'no tab'; b.click(); return 'start tab'})()`);
  await sleep(1500);
  evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/start race/i.test(b.textContent)); if(!b) return 'no race btn'; b.click(); return 'race'})()`);
  await sleep(7000);
}

if (free) {
  // START tab -> DRIVE button (free roam), which honours ?spawn.
  evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^start$/i.test(b.textContent.trim())); if(!b) return 'no tab'; b.click(); return 'start tab'})()`);
  await sleep(1200);
  evalJs(`(()=>{const b=document.getElementById('drive'); if(!b) return 'no drive btn'; b.click(); return 'drive'})()`);
  await sleep(4000);
}

if (driveMs > 0) {
  evalJs(`(()=>{const c=document.querySelector('canvas');window.__hold=setInterval(()=>c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',code:'ArrowUp',keyCode:38,which:38,bubbles:true})),80);return 'drive'})()`);
  await sleep(driveMs);
  evalJs(`(()=>{clearInterval(window.__hold);return 'stop'})()`);
  await sleep(300);
}

ab('screenshot', out);
const state = evalJs(`(()=>{const g=window.__openSpeed; return JSON.stringify({map:g?.mapId, kmh:Math.round((g?.current?.speed??0)*3.6)})})()`);
console.log(`saved ${out} ${state}`);
try { ab('close'); } catch { /* the session is already gone */ }
