// Build a file://-loadable copy of build/dist for offline headless verification.
// Vite emits absolute /assets/... URLs; a file:// origin needs them relative.
import { cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = join(root, 'build/dist');
const out = join(root, 'build/verify-dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });

const { readdir } = await import('node:fs/promises');
// Every page (index.html, model.html): only the leading slash of URL references is stripped.
for (const entry of await readdir(out)) {
  if (!entry.endsWith('.html')) continue;
  const page = join(out, entry);
  let html = await readFile(page, 'utf8');
  html = html
    .replaceAll('"/assets/', '"./assets/')
    .replaceAll("'/assets/", "'./assets/")
    .replaceAll('(/assets/', '(./assets/')
    .replaceAll('`/assets/', '`./assets/')
    .replaceAll('src="/', 'src="./')
    .replaceAll('href="/', 'href="./');
  await writeFile(page, html);
}

const jsDir = join(out, 'assets');
for (const entry of await readdir(jsDir)) {
  if (!entry.endsWith('.js')) continue;
  const file = join(jsDir, entry);
  let code = await readFile(file, 'utf8');
  // /assets/... , /maps/... , /garage/... fetched at runtime -> relative.
  code = code
    .replaceAll('`/assets/', '`./assets/')
    .replaceAll('`/maps/', '`./maps/')
    .replaceAll('`/garage/', '`./garage/')
    .replaceAll('"/vehicles/', '"./vehicles/')
    .replaceAll("'/sky/", "'./sky/")
    .replaceAll('"/sky/', '"./sky/')
    .replaceAll('"/scenery/', '"./scenery/')
    .replaceAll('",`/maps/', '",`./maps/')
    .replaceAll('("/assets/', '("./assets/')
    .replaceAll('("/maps/', '("./maps/')
    .replaceAll('("/garage/', '("./garage/');
  await writeFile(file, code);
}

console.log(`file-dist ready: ${out}`);
