// Arcade physics contract. Not tied to three.js; tested directly under node.
// Units: meters, seconds, radians. +X right, +Z back, -Z forward; yaw 0 = -Z.

export type CarInput = {
 /** 0..1 */
 throttle: number;
 /** 0..1 */
 brake: number;
 /** -1 left, +1 right */
 steer: number;
 handbrake: boolean;
 /** Hold to select reverse; only engages at a standstill. */
 reverse: boolean;
};

export type WheelState = {
 /** Wheel touches the ground. */
 contact: boolean;
 /** Suspension compression, 0 = fully extended, 1 = fully compressed. */
 compression: number;
 /** Rolling angle, radians. Decreases while reversing. */
 spin: number;
 /** Steering angle; 0 for the rear wheels. */
 steer: number;
};

export type CarState = {
 x: number;
 /** Body reference height above the suspension, meters. */
 y: number;
 z: number;
 /** Yaw, radians, increasing clockwise. */
 yaw: number;
 /** Body pitch, radians; positive under braking. */
 pitch: number;
 roll: number;
 /** Signed speed, km/h. Negative while reversing. */
 speed: number;
 rpm: number;
 /** Redline of the active car, for gauges. */
 rpmMax: number;
 /** -1 reverse, 0 neutral, 1.. forward gears. */
 gear: number;
 steerAngle: number;
 /** 0..1 slip; drives the skid marks and the sliding indicator. */
 slipFront: number;
 slipRear: number;
 /** Order: front-left, front-right, rear-left, rear-right. */
 wheels: WheelState[];
 /** Distance travelled along the circuit, meters. */
 distance: number;
 /**
  * How hard the car was last hit by another car, in metres per second of velocity change, decaying
  * over about half a second. The AI reads it so a knock actually unsettles a driver instead of
  * being steered out in the same frame.
  */
 impact: number;
};

export type Surface = 'road' | 'kerb' | 'ground';

/** Static world queries built once from the city plan. */
export interface World {
 heightAt(x: number, z: number): number;
 surfaceAt(x: number, z: number): Surface;
 /** Body circle vs obstacles: push-out normal + depth, or null when clear. */
 hit(x: number, z: number, radius: number): { nx: number; nz: number; depth: number } | null;
 /** Circuit center line, closed loop. */
 circuit: [number, number][];
 /** Drivable world extent, meters. The car is walled inside it. */
 bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
 /** True where the point is over sea or lake (island maps). Undrivable. */
 isWater?(x: number, z: number): boolean;
 /** Continuous immersion, in metres; shallow water remains traversable. */
 waterDepthAt?(x: number, z: number): number;
 maxWadeDepth?: number;
 /** Road heading change ~300 m ahead, in 1/1024 turn (positive = right); drives the slide assist. */
 curveAhead?(x: number, z: number): number;
 /** Track frame for race logic: distance along the loop and signed lateral offset (+ right). */
 locate?(x: number, z: number): { s: number; lateral: number; tx: number; tz: number };
 /** Point on the drivable surface at loop distance `s`, `lateral` metres right of centre. */
 surfacePoint?(s: number, lateral: number): { x: number; y: number; z: number; yaw: number };
 /** Loop length in metres (closed circuits). */
 length?: number;
 /** How far the drivable corridor reaches either side of the centre line at `s`, in metres.
  *  A tunnel, a bridge or a cutting is where this closes in, and where a driver aiming at a
  *  lane it cannot fit through puts itself into the wall. */
 corridor?(s: number): { left: number; right: number };
}

/** Shared final vehicle dimensions used by rendering and physics. */
export type VehicleDimensions = {
 wheelbase: number;
 trackWidth: number;
 wheelRadius: number;
};

/** Speed and handling values for one vehicle catalog entry. */
export type VehiclePhysics = {
 /** Car dataset id in src/data/arcade-cars.json (mcf1, gt90, cala …). */
 arcade: string;
 mass: number;
 topSpeed: number;
 torque: number;
 frontGrip: number;
 rearGrip: number;
 drag: number;
 brake: number;
};

/** Flattened profile passed to the pure physics model. */
export type VehicleProfile = VehiclePhysics & VehicleDimensions;

/**
 * Copies a car state into an existing one, reusing its wheel objects.
 *
 * The render loop keeps the previous and the current state so it can interpolate between them, and
 * it used `structuredClone` for that - six times per physics step with the opponents, 64 steps a
 * second. structuredClone serialises, which both costs far more than the twenty numbers here and
 * hands the collector a fresh object graph every step.
 */
export function copyCarState(into: CarState, from: CarState): CarState {
 into.x = from.x; into.y = from.y; into.z = from.z;
 into.yaw = from.yaw; into.pitch = from.pitch; into.roll = from.roll;
 into.speed = from.speed; into.rpm = from.rpm; into.rpmMax = from.rpmMax;
 into.gear = from.gear; into.steerAngle = from.steerAngle;
 into.slipFront = from.slipFront; into.slipRear = from.slipRear;
 into.distance = from.distance;
 into.impact = from.impact;
 for (let i = 0; i < from.wheels.length; i++) {
  const source = from.wheels[i];
  const target = into.wheels[i] ?? (into.wheels[i] = { contact: false, compression: 0, spin: 0, steer: 0 });
  target.contact = source.contact;
  target.compression = source.compression;
  target.spin = source.spin;
  target.steer = source.steer;
 }
 into.wheels.length = from.wheels.length;
 return into;
}

/** A fresh state with the same values, for the first frame of a drive. */
export const cloneCarState = (from: CarState): CarState =>
 copyCarState({ ...from, wheels: from.wheels.map(w => ({ ...w })) }, from);
