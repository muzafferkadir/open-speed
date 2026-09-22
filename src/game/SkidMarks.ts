import * as THREE from 'three';
import type { CarState } from '../physics/types.js';
import type { WheelView } from './types.js';

/** Shared working values: update() runs every frame and must not allocate. */
const center = new THREE.Vector3(), axle = new THREE.Vector3(), spin = new THREE.Quaternion();
const wasLeft = new THREE.Vector3(), wasRight = new THREE.Vector3();
/** The six corners of one skid quad, in draw order; refilled per segment. */
const quad: THREE.Vector3[] = [];

const CAPACITY = 2048;
/** Metres the ribbon sits above the contact patch, clear of the road without floating off it. */
const LIFT = .035;

type Contact = { center: THREE.Vector3; left: THREE.Vector3; right: THREE.Vector3; alpha: number };

/** Circular tyre-mark ribbon on a single buffer. */
export class SkidMarks {
 private readonly geometry = new THREE.BufferGeometry();
 private readonly positions = new Float32Array(CAPACITY * 18);
 private readonly colors = new Float32Array(CAPACITY * 24);
 private readonly contacts = new Map<THREE.Object3D, Contact>();
 private readonly texture = new THREE.CanvasTexture(SkidMarks.ribbon());
 private readonly mesh: THREE.Mesh;
 private cursor = 0;
 private count = 0;

 private static ribbon(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 2;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 64, 0);
  for (const [position, alpha] of [[0, 0], [.12, .65], [.25, .9], [.75, .9], [.88, .65], [1, 0]])
   gradient.addColorStop(position, `rgba(255,255,255,${alpha})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 2);
  return canvas;
 }

 constructor(scene: THREE.Scene) {
  // Soft-edged white ribbon; the colour is carried by the vertex alpha.
  const texture = this.texture;
  texture.anisotropy = 4;

  const uvs = new Float32Array(CAPACITY * 12);
  for (let i = 0; i < CAPACITY; i++) uvs.set([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], i * 12);
  this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
  this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
  this.geometry.setDrawRange(0, 0);

  const mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({
   color: '#171c19', map: texture, vertexColors: true, transparent: true,
   opacity: .48, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  scene.add(mesh);
  this.mesh = mesh;
 }

 /** Removes the ribbon from its scene and releases GPU buffers. */
 dispose() {
  this.mesh.removeFromParent();
  this.geometry.dispose();
  (this.mesh.material as THREE.Material).dispose();
  this.texture.dispose();
  this.contacts.clear();
 }

 reset() {
  this.contacts.clear();
  this.cursor = 0;
  this.count = 0;
  this.geometry.setDrawRange(0, 0);
 }

 update(state: CarState, car: THREE.Object3D, wheels: WheelView[], paused: boolean) {
  if (paused || Math.abs(state.speed) < 8) { this.contacts.clear(); return; }
  car.updateMatrixWorld(true);
  // This runs for four wheels every frame the car is moving, so the contact a wheel already has is
  // updated in place and the working vectors are shared: a fresh set per wheel per frame was a
  // steady drip of garbage for the whole race.
  for (const { pivot, steering, radius } of wheels) {
   const slip = steering ? state.slipFront : state.slipRear;
   const alpha = THREE.MathUtils.clamp((slip - .08) * 1.5, 0, 1);
   pivot.getWorldPosition(center);
   // On the road the wheel is the only thing that knows where the ground is: Last Resort runs from
   // 53 m below the origin to 186 m above it, and a mark laid at a fixed height was buried under
   // the road for four fifths of the lap. The hub less its own radius is the contact patch.
   center.y -= radius - LIFT;
   axle.set(1, 0, 0).applyQuaternion(pivot.getWorldQuaternion(spin));
   axle.y = 0;
   axle.normalize().multiplyScalar(.085);
   const previous = this.contacts.get(pivot);
   if (!previous) {
    this.contacts.set(pivot, {
     center: center.clone(), left: center.clone().sub(axle), right: center.clone().add(axle), alpha: 0,
    });
    continue;
   }
   const distance = center.distanceTo(previous.center);
   if (distance < .08) continue;
   wasLeft.copy(previous.left);
   wasRight.copy(previous.right);
   const wasAlpha = previous.alpha;
   previous.center.copy(center);
   previous.left.copy(center).sub(axle);
   previous.right.copy(center).add(axle);
   previous.alpha = alpha;
   if (distance > 4 || (!alpha && !wasAlpha)) continue;
   quad[0] = wasLeft; quad[1] = wasRight; quad[2] = previous.left;
   quad[3] = wasRight; quad[4] = previous.right; quad[5] = previous.left;
   for (let j = 0; j < quad.length; j++) {
    quad[j].toArray(this.positions, this.cursor * 18 + j * 3);
    const a = j === 0 || j === 1 || j === 3 ? wasAlpha : alpha;
    const at = this.cursor * 24 + j * 4;
    this.colors[at] = 1; this.colors[at + 1] = 1; this.colors[at + 2] = 1; this.colors[at + 3] = a;
   }
   this.cursor = (this.cursor + 1) % CAPACITY;
   this.count = Math.min(CAPACITY, this.count + 1);
  }
  this.geometry.attributes.position.needsUpdate = true;
  this.geometry.attributes.color.needsUpdate = true;
  this.geometry.setDrawRange(0, this.count * 6);
 }
}
