import type * as THREE from 'three';
import type { VehicleDimensions, VehiclePhysics } from '../physics/types.js';
import type { LampConfig } from './lamps.js';

/**
 * Where a car's wheels are, in the source model's own coordinates, so the bake can lift them out
 * of a one-piece body. One mark per axle, mirrored across the car: `along` and `across` are the
 * two horizontal source axes, `height` is up, and the pair is a cylinder of `radius` and `width`.
 * Marked by hand against `ONLY=<id> PREVIEW=1 npm run models`, which draws what each one takes.
 */
type WheelMarks = {
 axle: 'x' | 'y';
 front: WheelMark;
 rear: WheelMark;
 /** A wheel modelled on its own, from `<source>/wheels/<style>.glb`, dropped into each mark
  *  instead of the one the body was drawn with. */
 style?: string;
};

type WheelMark = {
 along: number;
 across: number;
 height: number;
 radius: number;
 width: number;
};

type BlankPlate = {
 center: [number, number, number];
 size: [number, number];
 thickness?: number;
 bevel?: number;
};

export type VehicleDesign = {
 id: string;
 name: string;
 /** Short line under the name in the garage, e.g. a model year. */
 subtitle?: string;
 description: string;
 model: {
  url: string;
  /**
   * A lighter twin used where the car is only ever seen at a distance - every opponent in a race
   * is the same car, so the field would otherwise cost five times the player's own detail.
   */
  lod?: string;
  source: string;
  sourceRotationZ: number;
   wheels?: WheelMarks;
  blankPlates?: BlankPlate[];
 };
 dimensions: VehicleDimensions;
 physics: VehiclePhysics;
 visual: {
  paint: string;
  tint: string;
  strip: string;
  /** Hue range (degrees) of the baked paint in the base colour texture. With `tint` set, texels
   *  in this range are re-hued to the tint at load, so one GLB serves every livery. */
  paintHue?: [number, number];
  /** Set where the car is painted white or silver: there is no hue to key on, so the swatch takes
   *  the texels that are pale instead - which the glass, the grille and the cabin are not. */
  palePaint?: boolean;
  /** Tail lamp mounts in model space, measured with the viewer; the body-box fractions are the fallback. */
  lamps?: LampConfig;
 };
};

/** Wheel view extracted from a loaded GLB: the pivot turns on Y, the rim on X. */
export type WheelView = {
 wheel: THREE.Object3D;
 pivot: THREE.Group;
 steering: boolean;
 /**
  * How much faster this rim turns than the physics wheel. The physics has one wheel radius for
  * the whole car; a staggered car does not, and rolling a 0.52 m rear at the rate of a 0.40 m
  * front is the wheels visibly turning at the wrong speed for the ground they are on.
  */
 spinScale: number;
 /** Rolling radius in metres, so a tyre mark can be laid at the contact patch. */
 radius: number;
};

/** The narrow input interface ChaseCamera sees (Input satisfies it structurally). */
export type ViewInput = { peek(): number; backView(): boolean };
