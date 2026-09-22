// Headless four-view screenshot of one model plus its measured summary, for agents.
//
// Usage: node scripts/verify/model-shot.mjs <vehicle-id | /scenery/palm.glb> [out.png]
//        [--url http://127.0.0.1:5173/] [--node name] [--spin deg] [--view rear] [--lamps on]
//        [--session name] [--size 1280x1000]
//
// Without --url the page is opened from build/verify-dist/model.html over file:// (run
// `npm run build && npm run verify:file-dist` first); nothing is served, nothing is shown.
// Uses a NAMED agent-browser session and closes only that session.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flags = new Set(['--url', '--node', '--spin', '--view', '--lamps', '--session', '--size']);
const positional = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
const target = positional[0];
if (!target) throw new Error('usage: model-shot.mjs <vehicle-id | glb url> [out.png]');
const safe = `${target}${opt('--node', '') ? `-${opt('--node', '')}` : ''}${opt('--view', '') ? `-${opt('--view', '')}` : ''}`.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
const out = resolve(root, positional[1] ?? `build/review/model-${safe}.png`);
const url = opt('--url', '');
const spin = opt('--spin', '');
const node = opt('--node', '');
const view = opt('--view', '');
const lamps = opt('--lamps', '');
const session = opt('--session', `model-shot-${process.pid}`);
const [width, height] = opt('--size', '1280x1000').split('x').map(Number);

const query = new URLSearchParams(target.endsWith('.glb') ? { model: target } : { vehicle: target });
if (node) query.set('node', node);
if (spin) query.set('spin', spin);
if (view) query.set('view', view);
if (lamps) query.set('lamps', lamps);
let page, extra = [];
if (url) page = `${url.replace(/\/$/, '')}/model.html?${query}`;
else {
  const dist = join(root, 'build/verify-dist/model.html');
  if (!existsSync(dist)) throw new Error('build/verify-dist missing: run npm run build && npm run verify:file-dist');
  page = `file://${dist}?${query}`;
  extra = ['--init-script', join(root, 'scripts/verify/file-origin-shim.js'), '--args', '--allow-file-access-from-files,--disable-web-security,--mute-audio'];
}

const ab = (...a) => execFileSync('agent-browser', ['--session', session, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A session closed a moment ago can still be tearing down; one retry covers that window.
const open = async (attempt = 0) => {
  try { ab('open', page, ...extra); }
  catch (error) { if (attempt) throw error; await sleep(800); await open(1); }
};
try {
  await open();
  ab('set', 'viewport', String(width), String(height));
  const expected = JSON.stringify(target);
  ab('wait', '--fn', `window.__model && window.__model.ready === true && (window.__model.error || window.__model.summary.target === ${expected})`);
  ab('screenshot', out);
  console.log(`saved ${out}`);
  const raw = ab('eval', 'JSON.stringify(window.__model)');
  console.log(JSON.stringify(JSON.parse(JSON.parse(raw)), null, 1));
} finally {
  try { ab('close'); } catch { /* the session is already gone; nothing to release */ }
}
