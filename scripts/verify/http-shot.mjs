// Headless screenshot of the running Open Speed dev server over HTTP.
//
// Usage: node scripts/verify/http-shot.mjs <out.png> [--url http://127.0.0.1:5173/]
//        [--session lr] [--map last-resort] [--drive ms] [--race] [--free]
//        [--spawn x,z,yawDeg] [--pose x,y,z,tx,ty,tz] [--settle ms]
//
// Uses a NAMED, isolated agent-browser session and never closes other sessions
// (`--all` is forbidden: it would interrupt supervisor/user browsers). The dev server must
// already be running; this script never starts one.
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const out = resolve(root, args[0] ?? 'build/review/http-shot.png');
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const url = opt('--url', 'http://127.0.0.1:5173/');
const session = opt('--session', 'lr-verify');
const map = opt('--map', 'last-resort');
const driveMs = Number(opt('--drive', 0));
const race = args.includes('--race');
const free = args.includes('--free');
const spawn = opt('--spawn', '');
const pose = opt('--pose', '');
const settle = Number(opt('--settle', 4500));

const ab = (...a) => execFileSync('agent-browser', ['--session', session, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const evalJs = (js) => { try { return ab('eval', js).trim(); } catch (e) { return `ERR ${e.message.split('\n')[0]}`; } };
// The browser is released however this script ends. Without it a thrown assertion leaves a
// headless Chrome behind, and a few of those burn a core each until someone notices the fan.
process.on('exit', () => { try { ab('close'); } catch { /* already gone */ } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const q = new URLSearchParams({ debug: '' });
if (spawn) q.set('spawn', spawn);
const target = `${url}${url.includes('?') ? '&' : '?'}${q.toString()}`;

ab('open', target, '--args', '--allow-file-access-from-files,--mute-audio');
await sleep(settle);

// Persist map choice and reload so the scene rebuilds for the requested map.
evalJs(`(()=>{const g=window.__openSpeed; if(!g) return 'no handle'; g.settings.set('map','${map}'); return 'map set'})()`);
ab('eval', 'location.reload()');
await sleep(settle + 2000);

if (race) {
  evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^start$/i.test(b.textContent.trim())); if(!b) return 'no tab'; b.click(); return 'start tab'})()`);
  await sleep(1500);
  evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/start race/i.test(b.textContent)); if(!b) return 'no race btn'; b.click(); return 'race'})()`);
  await sleep(8000);
}

if (free) {
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

// Freeze the chase camera at an explicit pose for reproducible comparison frames.
if (pose) {
  const [x, y, z, tx, ty, tz] = pose.split(',').map(Number);
  evalJs(`(()=>{const g=window.__openSpeed; const c=g.scene.getObjectByProperty('isCamera',true)||g.cameraRig; const cam=c.isCamera?c:(c.children||[]).find(o=>o.isCamera); if(!cam) return 'no camera'; cam.position.set(${x},${y},${z}); cam.lookAt(${tx},${ty},${tz}); cam.updateMatrixWorld(true); return 'posed'})()`);
  await sleep(400);
}

ab('screenshot', out);
const state = evalJs(`(()=>{const g=window.__openSpeed; if(!g) return 'no handle'; const c=g.scene?.getObjectByProperty('isCamera',true); return JSON.stringify({map:g.mapId, kmh:Math.round((g.current?.speed??0)*3.6), cam:c?[Math.round(c.position.x),Math.round(c.position.y),Math.round(c.position.z)]:null})})()`);
console.log(`saved ${out} ${state}`);
// Close only this named session.
ab('close');
