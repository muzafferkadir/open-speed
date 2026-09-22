import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import vehicles from '../data/vehicles.json';
import type { VehicleDesign } from '../game/types.js';
import { VehicleView } from '../game/VehicleView.js';

type ModelWindow = Window & {
 __model?: { ready: boolean; summary?: Summary; error?: string };
 /** Page pixel → world point in the view under it; how lamp mounts get measured off a screenshot. */
 __probe?: (px: number, py: number) => { view: string; world: number[] };
 /** Tail surface depth at a model-space (x, y): the +Z-most hit, so a lamp can sit flush on it. */
 __surfaceZ?: (x: number, y: number) => number | null;
};

type Summary = {
 target: string;
 size: number[];
 min: number[];
 max: number[];
 centerXZ: number[];
 groundGap: number;
 meshes: number;
 triangles: number;
 materials: string[];
 textures: number;
 nodes: string[];
 nodeCount: number;
 loadMs: number;
 wheels?: { nodes: string[]; wheelbase: number; trackWidth: number; radius: number[] };
 lamps?: { brake: number[][]; reverse: number[][] };
 catalog?: VehicleDesign['dimensions'];
};

type View = { label: string; camera: THREE.Camera };
type Loaded = { object: THREE.Object3D; wheels: VehicleView['wheels']; design?: VehicleDesign; lamps?: Summary['lamps'] };

const WHEEL = /^WHL[0-3]_H$/i;
const MAX_NODES = 24;
const FIT = .6;
/** Road speed the wheels roll at when `?roll` carries no value, km/h. */
const DEFAULT_ROLL_KMH = 40;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Four fixed views of one GLB (front, side, top, three-quarter) plus a measured summary for agents. */
export class ModelViewer {
 private readonly renderer: THREE.WebGLRenderer;
 private readonly scene = new THREE.Scene();
 private readonly root = new THREE.Group();
 private views: View[] = [];
 /** Wheels to roll and how fast, when `?roll` asks for it. */
 private rolling: { wheels: VehicleView['wheels']; radii: number[]; metresPerSecond: number } | null = null;
 private lastFrame = 0;

 constructor(private readonly canvas: HTMLCanvasElement) {
  this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.scene.background = new THREE.Color('#1c2024');
  const pmrem = new THREE.PMREMGenerator(this.renderer);
  this.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  this.scene.environmentIntensity = .35;
  pmrem.dispose();
  this.scene.add(new THREE.HemisphereLight('#dff0ff', '#4a4636', 1.4));
  const sun = new THREE.DirectionalLight('#fff4d8', 2.4);
  sun.position.set(3, 6, -4);
  this.scene.add(sun, this.root);
 }

 async start(params: URLSearchParams) {
  const target = params.get('vehicle') ?? params.get('model') ?? '';
  const wantsVehicle = params.has('vehicle');
  const spin = Number(params.get('spin') ?? 0) * Math.PI / 180;
  const out = window as ModelWindow;
  try {
   const started = performance.now();
   const loaded = await this.load(target, wantsVehicle, params.get('lamps') ?? '');
   const loadMs = Math.round(performance.now() - started);
   const object = this.isolate(loaded.object, params.get('node'));
   const { wheels, design } = loaded;
   object.rotation.y = spin;
   this.root.add(object);
   this.root.add(this.floor(object));
   const summary = { ...this.summarize(target, object, wheels, design, loaded.lamps), loadMs };
   this.print(summary);
   this.views = this.createViews(object, params.get('view') === 'rear');
   new ResizeObserver(() => this.resize()).observe(this.canvas);
   this.resize();
   if (params.has('roll')) this.roll(wheels, Number(params.get('roll')) || DEFAULT_ROLL_KMH);
   out.__model = { ready: true, summary };
   out.__probe = (px, py) => this.probe(px, py);
   out.__surfaceZ = (x, y) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(object, true)[0];
    return hit ? round(hit.point.z) : null;
   };
  } catch (error) {
   const message = error instanceof Error ? error.message : String(error);
   this.print({ error: message, usage: '?vehicle=<id from vehicles.json> | ?model=/scenery/palm.glb [&node=<name>] [&spin=deg] [&view=rear] [&lamps=on|hide] [&roll=<km/h>]' });
   out.__model = { ready: true, error: message };
  }
 }

 private async load(target: string, wantsVehicle: boolean, lampsOn = ''): Promise<Loaded> {
  const catalog = vehicles as VehicleDesign[];
  const design = catalog.find(d => d.id === target);
  if (wantsVehicle && !design) throw new Error(`Unknown vehicle '${target}'; known: ${catalog.map(d => d.id).join(', ')}`);
  if (design) {
   const view = new VehicleView();
   await view.load(design);
   if (lampsOn === 'hide') for (const m of [...view.group.getObjectsByProperty('name', 'brake-lamp'), ...view.group.getObjectsByProperty('name', 'reverse-lamp')]) m.removeFromParent();
   else view.setLamps(lampsOn === 'on', lampsOn === 'on');
   return { object: view.group, wheels: view.wheels, design, lamps: view.lampPositions() };
  }
  if (!target) throw new Error('No target: pass ?vehicle=<id> or ?model=<glb url>');
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(target);
  return { object: gltf.scene, wheels: [] };
 }

 /** Kit GLBs stack every piece on the origin; `?node=` shows one named subtree on its own. */
 private isolate(object: THREE.Object3D, name: string | null): THREE.Object3D {
  if (!name) return object;
  const node = object.getObjectByName(name);
  if (!node) throw new Error(`No node '${name}'; nodes: ${this.names(object).join(', ')}`);
  const group = new THREE.Group();
  group.attach(node);
  return group;
 }

 private names(object: THREE.Object3D): string[] {
  const list: string[] = [];
  object.traverse(node => { if (node.name) list.push(node.name); });
  return list;
 }

 private floor(object: THREE.Object3D): THREE.Object3D {
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  const extent = Math.ceil(Math.max(size.x, size.z, 1) * 1.5);
  const cell = extent > 8 ? 1 : .5;
  const grid = new THREE.GridHelper(extent * 2, extent * 2 / cell, '#5b6873', '#2e363d');
  const axes = new THREE.AxesHelper(Math.max(size.x, size.y, size.z) * .6);
  const group = new THREE.Group();
  group.add(grid, axes);
  return group;
 }

 private summarize(target: string, object: THREE.Object3D, wheels: VehicleView['wheels'], design?: VehicleDesign, lamps?: Summary['lamps']): Summary {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const materials = new Set<string>(), textures = new Set<THREE.Texture>(), nodes: string[] = [];
  let meshes = 0, triangles = 0, nodeCount = 0;
  object.traverse(node => {
   nodeCount++;
   if (node.name) nodes.push(node.name + (node.visible ? '' : ' (hidden)'));
   if (!(node instanceof THREE.Mesh)) return;
   meshes++;
   const geometry = node.geometry as THREE.BufferGeometry;
   triangles += (geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0) / 3;
   for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    materials.add(material.name || '(unnamed)');
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
   }
  });
  const summary: Summary = {
   target,
   size: size.toArray().map(round),
   min: box.min.toArray().map(round),
   max: box.max.toArray().map(round),
   centerXZ: [round((box.min.x + box.max.x) / 2), round((box.min.z + box.max.z) / 2)],
   groundGap: round(box.min.y),
   meshes,
   triangles: Math.round(triangles),
   materials: [...materials],
   textures: textures.size,
   nodes: nodes.slice(0, MAX_NODES),
   nodeCount,
   loadMs: 0,
  };
  if (wheels.length) summary.wheels = this.measureWheels(wheels);
  if (design) summary.catalog = design.dimensions;
  if (lamps) summary.lamps = lamps;
  return summary;
 }

 private measureWheels(wheels: VehicleView['wheels']) {
  const centers = wheels.map(({ pivot }) => pivot.getWorldPosition(new THREE.Vector3()));
  const front = centers.filter((_, i) => wheels[i].steering), rear = centers.filter((_, i) => !wheels[i].steering);
  const mean = (list: THREE.Vector3[], axis: 'x' | 'z') => list.reduce((sum, v) => sum + v[axis], 0) / (list.length || 1);
  const radius = wheels.map(({ wheel }) => round(new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3()).y / 2));
  return {
   nodes: wheels.map(({ wheel }) => wheel.name),
   wheelbase: round(Math.abs(mean(front, 'z') - mean(rear, 'z'))),
   trackWidth: round(Math.abs(mean(centers.filter(c => c.x > 0), 'x') - mean(centers.filter(c => c.x < 0), 'x'))),
   radius,
  };
 }

 private createViews(object: THREE.Object3D, rear = false): View[] {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  const distance = extent * 3;
  const ortho = (label: string, offset: THREE.Vector3, visible: [number, number], up = new THREE.Vector3(0, 1, 0)) => {
   const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, distance * 3);
   camera.userData.visible = visible;
   camera.up.copy(up);
   camera.position.copy(center).add(offset.multiplyScalar(distance));
   camera.lookAt(center);
   return { label, camera };
  };
  const perspective = new THREE.PerspectiveCamera(35, 1, .05, distance * 4);
  const quarter = rear ? new THREE.Vector3(-1, .55, 1) : new THREE.Vector3(-1, .55, -1);
  perspective.position.copy(center).add(quarter.normalize().multiplyScalar(extent * 1.9));
  perspective.lookAt(center);
  // `?view=rear` swaps the two forward views for their mirrors so tail lamps can be judged head on.
  if (rear) {
   const close = new THREE.PerspectiveCamera(35, 1, .05, distance * 4);
   close.position.copy(center).add(new THREE.Vector3(-.45, .35, 1).normalize().multiplyScalar(extent * 1.1));
   close.lookAt(center);
   return [
    ortho('rear (+Z) · X width', new THREE.Vector3(0, 0, 1), [size.x, size.y]),
    ortho('side (-X) · front → left', new THREE.Vector3(-1, 0, 0), [size.z, size.y]),
    { label: 'tail close-up (rear-left)', camera: close },
    { label: 'three-quarter rear-left', camera: perspective },
   ];
  }
  return [
   ortho('front (-Z) · X width', new THREE.Vector3(0, 0, -1), [size.x, size.y]),
   ortho('side (+X) · front → right', new THREE.Vector3(1, 0, 0), [size.z, size.y]),
   ortho('top · front ↑', new THREE.Vector3(0, 1, 0), [size.x, size.z], new THREE.Vector3(0, 0, -1)),
   { label: 'three-quarter front-left', camera: perspective },
  ];
 }

 private resize() {
  const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
  this.renderer.setSize(width, height, false);
  const aspect = width / height;
  for (const { camera } of this.views) {
   if (camera instanceof THREE.OrthographicCamera) {
    const [w, h] = camera.userData.visible as [number, number];
    const half = Math.max(w / aspect, h) * FIT;
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
   } else if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
   (camera as THREE.OrthographicCamera | THREE.PerspectiveCamera).updateProjectionMatrix();
  }
  this.render();
 }

 /**
  * Rolls the wheels as if the car were doing `kmh`, so a rim that is off its axle, off centre or
  * modelled inside out shows itself. A still frame hides all three: they only read as a wobble.
  *
  * Each wheel turns at its own measured radius rather than a shared one, which is what a staggered
  * car does on the road - the runtime scales the same way (`WheelView.spinScale`).
  */
 private roll(wheels: VehicleView['wheels'], kmh: number): void {
  if (!wheels.length) { this.print({ ...(window as ModelWindow).__model?.summary, roll: 'no WHL nodes to roll' }); return; }
  const radii = wheels.map(({ wheel }) => {
   const size = new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3());
   return Math.max(0.05, Math.max(size.y, size.z) / 2);
  });
  this.rolling = { wheels, radii, metresPerSecond: Math.abs(kmh) / 3.6 };
  this.lastFrame = performance.now();
  const step = (now: number) => {
   const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
   this.lastFrame = now;
   for (const [i, { wheel }] of this.rolling!.wheels.entries()) wheel.rotation.x += (this.rolling!.metresPerSecond / this.rolling!.radii[i]) * dt;
   this.render();
   requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
 }

 /** Page pixel → world point on the view under it (ortho views read exactly; the perspective ones approximate). */
 private probe(px: number, py: number) {
  const rect = this.canvas.getBoundingClientRect();
  const w = rect.width / 2, h = rect.height / 2;
  const col = px - rect.left < w ? 0 : 1, row = py - rect.top < h ? 0 : 1;
  const { label, camera } = this.views[row * 2 + col];
  const x = ((px - rect.left - col * w) / w) * 2 - 1;
  const y = -(((py - rect.top - row * h) / h) * 2 - 1);
  const world = new THREE.Vector3(x, y, 0).unproject(camera);
  return { view: label, world: [round(world.x), round(world.y), round(world.z)] };
 }

 private render() {
  const width = this.renderer.domElement.width, height = this.renderer.domElement.height;
  const w = width / 2, h = height / 2;
  this.renderer.setScissorTest(true);
  this.views.forEach(({ label, camera }, i) => {
   const x = (i % 2) * w, y = i < 2 ? h : 0;
   this.renderer.setViewport(x, y, w, h);
   this.renderer.setScissor(x, y, w, h);
   this.renderer.render(this.scene, camera);
   document.getElementById(`label-${i}`)!.textContent = label;
  });
  this.renderer.setScissorTest(false);
 }

 private print(data: unknown) {
  document.getElementById('info')!.textContent = JSON.stringify(data, null, 1).replace(/\[\n\s+([^\]]+?)\n\s+\]/g, (_, body: string) => `[${body.replace(/,\n\s+/g, ', ')}]`);
 }
}
