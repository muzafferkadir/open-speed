import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

/** Everything in a directory, as [path, source] pairs. */
const sources = dir => fs.readdirSync(dir)
 .filter(name => name.endsWith('.ts'))
 .map(name => [`${dir}/${name}`, fs.readFileSync(`${dir}/${name}`, 'utf8')]);

test('the physics depends on nothing above it', () => {
 // The driving model has to stay portable: no three, no DOM, and
 // nothing from the track or game layers - not even a type, which is enough to put the two in a
 // cycle.
 for (const [path, source] of sources('src/physics')) {
  for (const bad of ['../track/', '../game/', '../ui/', '../core/', "from 'three'"]) {
   assert.ok(!source.includes(bad), `${path} reaches for ${bad}`);
  }
 }
});

test('the track layer leans downward only', () => {
 for (const [path, source] of sources('src/track')) {
  assert.ok(!source.includes('../core/'), `${path} reaches back up into the core layer`);
 }
});
