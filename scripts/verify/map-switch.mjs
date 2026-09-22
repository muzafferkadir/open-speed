// Headless check of the deferred map load: picking a track on the Map tab must not reload the
// page or build the drive world; the world arrives when the player presses the start button.
// Runs two rounds (away from the starting map, then back) so the rebuild path is covered both ways.
//
// Usage: node scripts/verify/map-switch.mjs [--out dir]
//
// Loads build/verify-dist (see make-file-dist.mjs) over file:// with the origin shim. Chrome runs
// headless and muted; nothing is shown.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const shots = opt('--out', join(root, 'build/review'));
const buildTimeout = Number(opt('--build-timeout', 45000));

const dist = join(root, 'build/verify-dist/index.html');
if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && node scripts/verify/make-file-dist.mjs');
const shim = join(root, 'scripts/verify/file-origin-shim.js');

// One isolated session per process, and only this one is ever closed: a shared browser would mix
// this run's page with another's.
const session = `map-switch-${process.pid}`;
const ab = (...a) => {
 try { return execFileSync('agent-browser', [a[0], '--session', session, ...a.slice(1)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
 catch (e) { throw new Error(`agent-browser ${a[0]} failed: ${e.stderr || e.message}`); }
};
// The browser is released however this script ends. Without it a thrown assertion leaves a
// headless Chrome behind, and a few of those burn a core each until someone notices the fan.
process.on('exit', () => { try { ab('close'); } catch { /* already gone */ } });

// agent-browser prints the evaluated value as JSON. A JSON string result therefore arrives
// double-encoded, so unwrap until a value (not a string) comes out.
const evalJs = js => {
 let value = JSON.parse(ab('eval', js).trim());
 while (typeof value === 'string') value = JSON.parse(value);
 return value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Polls an expression until it is truthy or the timeout runs out. */
async function waitFor(js, timeout = 15000) {
 const deadline = Date.now() + timeout;
 while (Date.now() < deadline) {
  if (await evalJs(js)) return true;
  await sleep(300);
 }
 return false;
}

let failures = 0;
const assert = (ok, message) => { if (ok) console.log(`ok ${message}`); else { failures++; console.error(`FAIL ${message}`); } };
const clickText = text => evalJs(`(()=>{const re=new RegExp(${JSON.stringify(text)},'i'); const b=[...document.querySelectorAll('button')].find(b=>re.test(b.textContent.trim())); if(!b) return JSON.stringify(false); b.click(); return JSON.stringify(true)})()`);

ab('close', '--all');
ab('open', `file://${dist}?debug`, '--init-script', shim,
 '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio');
await sleep(3500);
evalJs(`(()=>{window.__loads=1; window.__err=[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error))); addEventListener('unhandledrejection',e=>window.__err.push(String((e.reason&&e.reason.message)||e.reason))); return JSON.stringify(1)})()`);

const state = () => evalJs(`(()=>({map:__openSpeed.mapId, drive:__openSpeed.drive?.mapId ?? false, loads:window.__loads, garage:document.body.classList.contains('in-garage'), loading:__openSpeed.loading, message:document.getElementById('message').textContent, screen:document.getElementById('loading-screen').style.display, err:(window.__err||[]).slice(-3)}))()`);

const start = await state();
assert(start.drive === false, `the garage is up with no drive world yet (map ${start.map})`);

/** Leaves the drive screen for the garage: pause menu, then its exit button. */
async function enterGarage(label) {
 if (evalJs(`document.body.classList.contains('in-garage')`)) return;
 evalJs(`(()=>{document.getElementById('menu-toggle').click(); return JSON.stringify(1)})()`);
 await sleep(300);
 const ok = await clickText('^exit to menu$');
 assert(ok === true, `${label}: exit to menu found`);
 await sleep(1500);
 assert(evalJs(`document.body.classList.contains('in-garage')`) === true, `${label}: back in the garage`);
}

/** Steps the Map tab selector to `target`, then drives and returns the state after the build. */
async function pickAndDrive(target, label) {
 await clickText('^map$');
 await sleep(400);
 const from = (await state()).map;
 const steps = evalJs(`(()=>{const g=__openSpeed; const i=g.maps.findIndex(m=>m.id==='${target}'); const c=g.maps.findIndex(m=>m.id===g.mapId); const n=((i-c)+g.maps.length)%g.maps.length; const dir=[...document.querySelectorAll('#map-selector .selector-arrow')].find(a=>Number(a.dataset.dir)===1); for(let k=0;k<n;k++) dir.click(); return JSON.stringify(n)})()`);
 assert(steps > 0, `${label}: stepped the track selector ${steps}x (${from} -> ${target})`);
 await sleep(1200);
 const picked = await state();
 assert(picked.loads === 1, `${label}: the page did not reload on the map switch`);
 assert(picked.map === target, `${label}: picked map is ${picked.map}, expected ${target}`);
 assert(picked.drive !== target, `${label}: the drive world for ${target} is not built yet (stage: ${picked.drive})`);
 ab('screenshot', join(shots, `map-switch-${target}.png`));

 const tab = await clickText('^start$');
 assert(tab === true, `${label}: the Start tab was found`);
 await waitFor(`!document.getElementById('drive').disabled`, 5000);
 evalJs(`(()=>{document.getElementById('drive').click(); return JSON.stringify(1)})()`);
 const built = await waitFor(`__openSpeed.drive?.mapId === '${target}'`, buildTimeout);
 const driving = await state();
 assert(built && driving.drive === target, `${label}: the drive world is built on the start button (stage: ${driving.drive}, loading: ${driving.loading}, screen: ${driving.screen}, message: ${driving.message}, err: ${JSON.stringify(driving.err)})`);
 assert(driving.map === target, `${label}: driving the picked map (${driving.map})`);
 const left = await waitFor(`!document.body.classList.contains('in-garage')`, 5000);
 assert(left, `${label}: the app left the garage into drive (message: ${driving.message})`);
 ab('screenshot', join(shots, `map-switch-drive-${target}.png`));
 return driving;
}

// Round 1 goes to whichever track the app did not boot on, round 2 comes back: the point is that
// the switch works both ways, whichever map the saved setting left behind.
const mapIds = ab('eval', `(()=>__openSpeed.maps.map(m=>m.id).join(','))()`).trim().replace(/^"|"$/g, '').split(',');
const away = mapIds.find(id => id !== start.map) ?? start.map;
await pickAndDrive(away, 'round 1');
await enterGarage('round 2');
await pickAndDrive(start.map, 'round 2');

ab('close');
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log(`all checks passed; screenshots in ${shots}`);
