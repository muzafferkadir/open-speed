// Shrink every GLB under assets/ in place: meshopt geometry compression + WebP textures.
// Lossless apart from vertex quantization; runtime needs MeshoptDecoder on the GLTFLoader.
// flatten/join stay OFF: scenery kits keep one named top-level node per model and the loaders
// look parts up by that name. Joining them merges the whole kit into one mesh.
// Re-running is safe (already-compressed files just round-trip).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'assets');
const files=fs.readdirSync(dir,{recursive:true}).filter(f=>f.endsWith('.glb'));

for(const file of files){
 const src=path.join(dir,file);
 const before=fs.statSync(src).size;
 execFileSync('npx',['gltf-transform','optimize',src,src,
  '--compress','meshopt','--simplify','false','--texture-compress','webp',
  '--flatten','false','--join','false','--instance','false'],{cwd:root,stdio:'ignore'});
 const after=fs.statSync(src).size;
 console.log(`${file}: ${(before/1e6).toFixed(2)} MB -> ${(after/1e6).toFixed(2)} MB`);
}
