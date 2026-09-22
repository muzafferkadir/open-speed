// Headless screenshot of one car in the garage showroom, so a new vehicle can be reviewed in
// the real flow (selector, lighting, ground contact) rather than only in the model viewer.
//
// Usage: node scripts/verify/garage-shot.mjs <vehicle-id> [--out dir]
//
// Loads build/verify-dist over file:// with the origin shim. Chrome runs headless and muted.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const id = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const shots = opt('--out', join(root, 'build/review'));
if (!id) throw new Error('usage: node scripts/verify/garage-shot.mjs <vehicle-id> [--out dir]');

const dist = join(root, 'build/verify-dist/index.html');
if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && node scripts/verify/make-file-dist.mjs');
const shim = join(root, 'scripts/verify/file-origin-shim.js');

const ab = (...a) => execFileSync('agent-browser', ['--session', session, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const evalJs = js => {
 const raw = ab('eval', js).trim();
 try {
  let value = JSON.parse(raw);
  while (typeof value === 'string') value = JSON.parse(value);
  return value;
 } catch {
  // agent-browser prints plain strings without quotes in some modes; treat the line as one.
  return raw;
 }
};
// The browser is released however this script ends. Without it a thrown assertion leaves a
// headless Chrome behind, and a few of those burn a core each until someone notices the fan.
process.on('exit', () => { try { ab('close'); } catch { /* already gone */ } });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const session = opt('--session', `garage-shot-${process.pid}`);
// A session closed a moment ago can still be tearing down; one retry covers that window.
const open = async (attempt = 0) => {
 try { ab('open', `file://${dist}?debug`, '--init-script', shim, '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio'); }
 catch (error) { if (attempt) throw error; await sleep(800); await open(1); }
};
await open();
await sleep(3500);

const designs = evalJs('(()=>[...__openSpeed.designs].map(d=>d.id))()');
const target = designs.indexOf(id);
if (target < 0) throw new Error(`vehicle ${id} is not in the garage roster: ${designs.join(', ')}`);

const steps = evalJs(`(()=>{const g=__openSpeed; const t=${target}; const d=t>g.vehicleIndex?1:-1; const n=Math.abs(t-g.vehicleIndex); const a=[...document.querySelectorAll('#vehicle-selector .selector-arrow')].find(x=>Number(x.dataset.dir)===d); for(let i=0;i<n;i++) a.click(); return JSON.stringify(n)})()`);
await sleep(2500);
const label = evalJs("document.querySelector('#vehicle-selector strong').textContent");
const index = evalJs('__openSpeed.vehicleIndex');
const file = join(shots, `garage-${id}.png`);
ab('screenshot', file);
try { ab('close'); } catch { /* the session is already gone; nothing to release */ }
if (index !== target) throw new Error(`selector landed on index ${index}, expected ${target} (${label})`);
console.log(`saved ${file} — ${label} (index ${index}, ${steps} step(s))`);
