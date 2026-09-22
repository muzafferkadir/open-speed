import * as THREE from 'three';
import { $ } from '../core/dom.js';
import type { VehicleDesign } from './types.js';
import type { VehicleView } from './VehicleView.js';
import { profileFov } from '../core/ScreenProfile.js';
import { Minimap, type TerrainField } from '../ui/Minimap.js';
import type { RoadLine } from '../track/types.js';
import type { MapEntry } from '../track/maps.js';
import type { MapContext } from '../track/mapContext.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GarageRoom, PLATFORM_TOP } from './GarageRoom.js';

/** Car angle the menu returns to: three-quarter front, like the concept art. */
const REST_ANGLE = -.9;

/** ‹ name › carousel: arrows step through `count` items, the label shows the current one. */
class Selector {
 private readonly name: HTMLElement;
 private readonly dots: HTMLElement;
 private index = 0;

 constructor(root: HTMLElement, private readonly count: number, onPick: (index: number) => void) {
  this.name = root.querySelector('strong')!;
  this.dots = root.querySelector('.selector-dots')!;
  for (let i = 0; i < count; i++) this.dots.append(document.createElement('i'));
  root.querySelectorAll<HTMLButtonElement>('.selector-arrow').forEach(arrow => {
   arrow.onclick = () => onPick(this.step((this.index + Number(arrow.dataset.dir) + count) % count));
  });
 }

 /** Moves the highlight at once, so fast repeat clicks land on the index the player sees.
  *  The label is filled in by `set` once the picked item has loaded. */
 private step(index: number): number {
  this.index = index;
  this.highlight();
  return index;
 }

 set(index: number, label: string) {
  this.index = index;
  this.name.textContent = label;
  this.highlight();
 }

 private highlight() {
  Array.from(this.dots.children).forEach((dot, i) => dot.classList.toggle('on', i === this.index));
 }
}

/** Showroom scene plus the car and track selectors and the per-map menu copy. */
export class Garage {
 readonly scene = new THREE.Scene();
 readonly camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 100);
 private readonly vehicleSelector: Selector;
 private readonly car: THREE.Object3D;
 private readonly view: VehicleView;
 private readonly designs: VehicleDesign[];
 private menuMap: Minimap;
 private readonly menuMapCanvas: HTMLCanvasElement;
 private readonly mapSelector?: Selector;
 private readonly room = new GarageRoom();
 private swatches: HTMLElement[] = [];
 private tab = 'my-ride';
 private idleSeconds = 0;
 private dragging = false;
 private active = true;

 constructor(view: VehicleView, canvas: HTMLElement, designs: VehicleDesign[], onPick: (index: number) => void, circuit: THREE.Vector3[], maxAnisotropy: number, renderer: THREE.WebGLRenderer,
             roadLines: RoadLine[] = [], tile = 0, terrain?: TerrainField, maps: MapEntry[] = [], mapId = '', onMap: (id: string) => void = () => {}) {
  this.view = view;
  this.car = view.group;
  this.designs = designs;
  this.vehicleSelector = new Selector($('vehicle-selector'), designs.length, onPick);
  if (maps.length) {
   const current = Math.max(0, maps.findIndex(map => map.id === mapId));
   this.mapSelector = new Selector($('map-selector'), maps.length, index => onMap(maps[index].id));
   this.mapSelector.set(current, maps[current].name);
   this.setMap(maps[current]);
  }
  this.menuMapCanvas = $<HTMLCanvasElement>('menu-map');
  this.menuMap = new Minimap(this.menuMapCanvas, circuit, 760, 560, 34, roadLines, tile, terrain);
  this.menuMap.draw(circuit[0].x, circuit[0].z);
  this.scene.background = new THREE.Color('#0b0d0f');
  // Without an environment, metal and paint have nothing to reflect but the light
  // sources themselves, which is what turns highlights into white blobs.
  const pmrem = new THREE.PMREMGenerator(renderer);
  this.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  // A studio box at full strength flattens everything; it is a reflection source, not a key light.
  this.scene.environmentIntensity = .22;
  pmrem.dispose();
  this.scene.add(this.room.group);
  void this.room.load(maxAnisotropy);
  // Offset right of centre and panned left, so the car reads three-quarter rather than head-on.
  this.camera.position.set(-5.6, 2.3, -8.2);
  this.camera.lookAt(3.3, 1.2, 1.2);
  this.bindDrag(canvas);
  this.bindPaint();

  this.room.turntable.add(this.car);
  this.car.position.y = PLATFORM_TOP;
  this.setHeadlights(false);

 }

 /** Redraws the Map tab for a map the player just picked: copy plus the plan view.
  *  The drive world is only built later, when the start button is pressed. */
 showMapPreview(context: MapContext, map: MapEntry, index?: number) {
  this.menuMap = new Minimap(this.menuMapCanvas, context.circuit, 760, 560, 34, context.roadLines, context.tile, context.terrain);
  this.menuMap.draw(context.circuit[0]?.x ?? 0, context.circuit[0]?.z ?? 0);
  if (index !== undefined) this.mapSelector?.set(index, map.name);
  this.setMap(map);
 }

 /** Fills the Map and Start cards from the map catalog entry. */
 private setMap(map: MapEntry) {
  $('map-kicker').textContent = map.kicker;
  $('map-title').textContent = map.name;
  $('map-lede').textContent = map.description;
  $('map-mode').textContent = map.mode;
  $('map-terrain').textContent = map.terrain;
  $('map-layout').textContent = map.layout;
  const start = map.start;
  $('start-kicker').textContent = start.kicker;
  $('start-title').textContent = start.title;
  $('start-lede').textContent = start.lede;
  $('start-photo').replaceChildren(start.photo[0], document.createElement('br'), Object.assign(document.createElement('b'), { textContent: start.photo[1] }));
  Array.from($('start-facts').querySelectorAll('span')).forEach((span, i) => {
   const [text, detail] = start.facts[i] ?? ['', ''];
   span.replaceChildren(text, Object.assign(document.createElement('small'), { textContent: detail }));
  });
  $('drive-label').textContent = start.button;
 }

 /**
  * The paint swatches. The colour is a shader uniform on the car's own texture, so a click costs
  * nothing and the car keeps its shading, its dirt and its shadows - it is the same paint under a
  * different light, not a flat tint laid over the top.
  */
 private bindPaint() {
  this.swatches = Array.from(document.querySelectorAll('.paint-swatch')) as HTMLElement[];
  for (const swatch of this.swatches) {
   swatch.addEventListener('click', () => {
    for (const other of this.swatches) other.classList.toggle('selected', other === swatch);
    // The first chip carries no colour: it is the paint the car was built in.
    this.view.setPaint(getComputedStyle(swatch).getPropertyValue('--swatch').trim() || null);
   });
  }
  this.asPainted();
 }

 /** Back to the chip with no colour on it, which is where a car that has just loaded stands. */
 private asPainted() {
  this.swatches.forEach((swatch, index) => swatch.classList.toggle('selected', index === 0));
 }

 /** Headlights read as glare in the menu; they belong on the road. */
 private setHeadlights(on: boolean) {
  this.view.setHeadlights(on);
 }

 setTab(tab: string) { this.tab = tab; this.applyTab(); }
 /** The car only belongs on the showroom tabs; the map tab draws the track over the stage. */
 private applyTab() { this.car.visible = this.tab === 'my-ride' || this.tab === 'start'; }

 enter() { this.room.turntable.add(this.car); this.car.position.y = PLATFORM_TOP; this.setHeadlights(false); this.active = true; this.resetView(); }
 exit() { this.active = false; this.car.position.y = 0; this.setHeadlights(false); }
 update(dt: number) {
  if (!this.active || this.dragging) return;
  this.idleSeconds += dt;
  if (this.idleSeconds >= .5) this.room.turntable.rotation.y += dt * .12;
 }

 /** Horizontal drag spins the platform; the camera never moves. */
 private bindDrag(canvas: HTMLElement) {
  let lastX = 0;
  canvas.addEventListener('pointerdown', event => {
   if (!this.active) return;
   this.dragging = true;
   lastX = event.clientX;
   canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
   if (!this.dragging) return;
   this.room.turntable.rotation.y += (event.clientX - lastX) * .006;
   lastX = event.clientX;
  });
  const release = () => { if (this.dragging) { this.dragging = false; this.idleSeconds = 0; } };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
 }

 private resetView() {
  this.settleView();
  this.room.turntable.rotation.y = REST_ANGLE;
 }

 /** Drops a drag and the idle count without touching the angle the car is being shown at. */
 private settleView() {
  this.idleSeconds = 0;
  this.dragging = false;
 }
 setAspect(aspect: number) {
  this.camera.aspect = aspect;
  this.camera.fov = profileFov(43, aspect);
  this.camera.updateProjectionMatrix();
 }
 setStatus(text: string) { $('garage-status').textContent = text; }

 /** Refreshes name, description and the 1..10 stat rows for the selected car. */
 refresh(index: number) {
  // The angle stays: stepping through the cars is comparing them, and snapping back to the
  // three-quarter view on every step throws away the side or the tail the player was looking at.
  this.settleView();
  this.applyTab(); // a model that finished loading has just re-shown the group
  // A car arrives in the colour it was built in; the chips have to say so.
  this.asPainted();
  const design = this.designs[index];
  $('garage-name').textContent = design.name;
  $('garage-subtitle').textContent = design.subtitle ?? '';
  $('garage-description').textContent = design.description;
  $('garage-status').textContent = '';
  const score = (value: number) => Math.max(1, Math.min(10, Math.round(value * 10) / 10));
  const profile = design.physics;
  const stats = [
   ['Top speed', score(profile.topSpeed / 30), `${profile.topSpeed} km/h cap`],
   ['Acceleration', score(profile.torque / profile.mass * 25), ''],
   ['Grip', score((profile.frontGrip + profile.rearGrip) * 1.6), ''],
   ['Braking', score(profile.brake / 1.5), ''],
  ] as const;
  $('garage-stats').replaceChildren();
  for (const [label, rating, detail] of stats) {
   const row = document.createElement('div');
   row.className = 'stat-row';
   const title = document.createElement('span');
   title.textContent = label;
   const value = document.createElement('strong');
   value.textContent = `${rating}/10`;
   const squares = document.createElement('div');
   squares.className = 'stat-squares';
   squares.setAttribute('aria-label', `${label}: ${rating}/10`);
   for (let i = 1; i <= 10; i++) {
    const square = document.createElement('i');
    square.className = i <= Math.round(rating) ? 'on' : '';
    squares.append(square);
   }
   const small = document.createElement('small');
   small.textContent = detail;
   row.append(title, value, squares, small);
   $('garage-stats').append(row);
  }
  this.vehicleSelector.set(index, design.name);
 }
}
