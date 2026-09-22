import * as THREE from 'three';
import type { ViewInput } from './types.js';
import { profileFov } from '../core/ScreenProfile.js';
import { Occluders, pullInsideWalls } from './occlusion.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Shared working vectors: update() runs every frame and must not allocate. */
const offset = new THREE.Vector3(), aim = new THREE.Vector3(), flat = new THREE.Vector3();

/** Default chase: a fixed 9 m back / 3.8 m up. Distance never changes with speed; only the
 *  heading follows the car with a lag, so corners swing the view round smoothly. */
const CHASE_BACK = 9, CHASE_UP = 3.8;
/** Aim point ahead of the car; keeps the road, not the bumper, in the middle of the frame. */
const CHASE_AIM = new THREE.Vector3(0, 1.7, -7);
/** Heading follow rate (1/s): lower = lazier swing into corners. */
const CHASE_TURN = 4.5;

/** Chase camera: speed-scaled default chase, two fixed modes plus corner/rear views. */
export class ChaseCamera {
 readonly camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 2500);
 private readonly offsets = [
  new THREE.Vector3(0, CHASE_UP, CHASE_BACK),
  new THREE.Vector3(0, 3.0, 6.5),
  new THREE.Vector3(0, 1.25, -1.45),
 ];
 private mode = 0;
 /** Solid track geometry the camera must not pass through (tunnels, walls, cliffs). */
 private occluders = new Occluders();
 private aspect = innerWidth / innerHeight;
 /** Lagged heading the default chase hangs from. */
 private chaseYaw = 0;

 cycle() { this.mode = (this.mode + 1) % this.offsets.length; }

 /** Track geometry to keep the camera inside. Pass nothing to go back to a free camera. */
 setOccluders(occluders: Occluders) { this.occluders = occluders; }

 /** Keeps the camera on this side of the track geometry (tunnels, walls, cliffs). */
 private avoidWalls(position: THREE.Vector3) { pullInsideWalls(this.camera.position, position, this.occluders); }

 setAspect(aspect: number) {
  this.aspect = aspect;
  this.camera.aspect = aspect;
  this.camera.fov = profileFov(65, aspect);
  this.camera.updateProjectionMatrix();
 }

 /** Widens the field of view with speed (0-1) for a sense of rush; the default chase keeps a fixed lens. */
 applySpeedKick(speed: number) {
  this.camera.fov = profileFov(65 + (this.mode === 0 ? 0 : speed * 5), this.aspect);
  this.camera.updateProjectionMatrix();
 }

 private get chase(): boolean { return this.mode === 0; }

 /**
  * Start-line sweep: from a tight, zoomed front-quarter shot the camera arcs round the car and
  * pulls out until, at u = 1, it sits exactly where the default chase would. Eased so most of
  * the motion happens early and the last stretch is a slow settle behind the countdown.
  */
 cinematic(position: THREE.Vector3, yaw: number, u: number) {
  const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
  const angle = Math.PI * .8 * (1 - e);
  const radius = 4.5 + (CHASE_BACK - 4.5) * e, height = 1.3 + (CHASE_UP - 1.3) * e;
  offset.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius).applyAxisAngle(UP, yaw);
  this.camera.position.copy(offset.add(position));
  aim.set(0, 1, 0).lerp(CHASE_AIM, e).applyAxisAngle(UP, yaw).add(position);
  this.camera.lookAt(aim);
  this.camera.fov = profileFov(40 + 25 * e, this.aspect);
  this.camera.updateProjectionMatrix();
  this.chaseYaw = yaw;
  this.mode = 0;
 }

 /** Where the rig wants the camera. The returned vector is shared, so callers must not keep it. */
 private target(position: THREE.Vector3, yaw: number, input: ViewInput, speed: number): THREE.Vector3 {
  const side = input.peek(), back = input.backView();
  void speed;
  if (back) offset.set(0, 2.4, -8.2);
  else if (side) offset.set(side * 6, 2.8, 6);
  else offset.copy(this.offsets[this.mode]);
  return offset.applyAxisAngle(UP, yaw).add(position);
 }

 /** @param speed forward speed in m/s (signed). */
 snap(position: THREE.Vector3, yaw: number, input: ViewInput, speed = 0) {
  this.chaseYaw = yaw;
  this.camera.position.copy(this.target(position, yaw, input, speed));
 }

 /** @param speed forward speed in m/s (signed). */
 update(dt: number, position: THREE.Vector3, yaw: number, input: ViewInput, speed = 0) {
  const target = this.target(position, yaw, input, speed);
  const looking = !!(input.peek() || input.backView());
  if (this.chase && !looking) {
   // Position is rigid (constant distance); only the heading eases toward the car's yaw.
   const turn = Math.atan2(Math.sin(yaw - this.chaseYaw), Math.cos(yaw - this.chaseYaw));
   this.chaseYaw += turn * (1 - Math.exp(-dt * CHASE_TURN));
   this.camera.position.copy(flat.set(0, CHASE_UP, CHASE_BACK).applyAxisAngle(UP, this.chaseYaw).add(position));
   this.avoidWalls(position);
   this.camera.lookAt(aim.copy(CHASE_AIM).applyAxisAngle(UP, this.chaseYaw).add(position));
   return;
  }
  // Side/rear looks cut straight to their view; only the fixed camera modes ease.
  if (looking) this.camera.position.copy(target);
  else this.camera.position.lerp(target, 1 - Math.exp(-dt * 11));
  const horizontal = flat.set(this.camera.position.x - position.x, 0, this.camera.position.z - position.z);
  const max = Math.hypot(target.x - position.x, target.z - position.z) + 1.25;
  if (horizontal.length() > max) {
   horizontal.setLength(max);
   this.camera.position.x = position.x + horizontal.x;
   this.camera.position.z = position.z + horizontal.z;
  }
  this.camera.position.y = target.y;
  this.avoidWalls(position);
  this.camera.lookAt(aim.set(0, 0.75, looking ? 0 : -9).applyAxisAngle(UP, yaw).add(position));
 }
}
