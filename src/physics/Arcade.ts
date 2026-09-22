// Arcade driving model: pure integer-flavoured math, no tyre or suspension simulation.
// Pure math on a plain state object; 64 Hz fixed tick, angles in turns, g = 10.

export type ArcadeData = {
 id: string; name: string; mass: number; gears: number; shiftTicks: number;
 ratio: number[]; eff: number[]; torque: number[]; redline: number; maxVel: number;
 maxBrake: number; brakeInc: number[]; brakeDec: number[]; steerAccel: number;
 turnIn: number; turnOut: number; gasOff: number; slideMult: number; slideAssist: number;
 pushFactor: number; lowTurn: number; highTurn: number;
};

export type ArcadeInput = { throttle: number; brake: number; steer: number; hand: boolean; reverse: boolean };
export type Vec3 = { x: number; y: number; z: number };

export type ArcadeState = {
 data: ArcadeData; apn: number[]; top: number[];
 x: number; z: number; yaw: number;
 vx: number; vy: number; vz: number;
 vFwd: number; vLat: number; yawRate: number; speed: number;
 rpm: number; gear: number; prevGear: number; shift: number; skid: number; lock: number;
 thr: number; brk: number; steer: number; steerReq: number; hand: number; rev: number;
 smoke: number; acc: number;
};

export const TICK = 1 / 64;
const G = 10;
const TAU = Math.PI * 2;
const TURN_GRIP = 13;
const SK1 = [1, 1, 0.6, 0.9, 1.5, 1];
const SK2 = [0.1, 0.1, 0.02, 0.05, 0.1, 0];
const SL1 = [0.1, 1, 0.3, 0.3, 0.5, 0];
const SL2 = [0, 1, 2.5, 3, 4, 1];
/** Surface grip table. Index 0 tarmac, 4 kerb, 9 dirt. */
export const SURFACE_GRIP = [1, 0.99, 0.98, 0.97, 0.9, 0.8, 0.75, 0.7, 0.65, 0.6];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const trunc = Math.trunc;
const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Slope gravity acceleration for one tick.
 *  gFwd is -10 * forward.y; the driven car feels an eighth of it. Whether the slope helps or
 *  fights is decided on the sign of E = (gFwd/8) * vFwd, with a 0.1 dead band: pushing the same
 *  way as the car gives the full term, pushing against it a quarter of it, and inside the band
 *  nothing. Getting those two branches the wrong way round stalls a car on a steep climb.
 *  `slopeMode` 0 disables the dead band and always applies the full term. */
export function slopeGravity(gFwd: number, vFwdOld: number, slopeMode: number): number {
 const p = (gFwd / 8) * vFwdOld;
 if (p > 0.1 || slopeMode === 0) return gFwd / 8;
 if (p < -0.1) return gFwd / 32;
 return 0;
}

export function createArcadeState(data: ArcadeData): ArcadeState {
 return {
  data,
  apn: data.ratio.map((r, i) => (r * data.eff[i]) / (data.mass * 10)),
  top: data.ratio.map(r => (r ? data.redline / r : 0)),
  x: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0,
  vFwd: 0, vLat: 0, yawRate: 0, speed: 0,
  rpm: 0, gear: 2, prevGear: 1, shift: 0, skid: 0, lock: 0,
  thr: 0, brk: 0, steer: 0, steerReq: 0, hand: 0, rev: 0, smoke: 0, acc: 0,
 };
}

export function resetArcade(car: ArcadeState, x: number, z: number, yaw: number): void {
 Object.assign(car, {
  x, z, yaw, vx: 0, vy: 0, vz: 0, vFwd: 0, vLat: 0, yawRate: 0, speed: 0,
  rpm: 0, gear: 2, prevGear: 1, shift: 0, skid: 0, lock: 0, thr: 0, brk: 0, steer: 0, steerReq: 0, hand: 0, rev: 0, smoke: 0, acc: 0,
 });
}

const torqueAt = (d: ArcadeData, rpm: number) => d.torque[clamp(rpm >> 8, 0, 40)];

function inputs(car: ArcadeState, input: ArcadeInput): void {
 const d = car.data;
 const thrReq = input.throttle > 0.5 ? 248 : 0;
 const brkReq = input.brake > 0.5 ? 248 : 0;
 const steerReq = clamp(trunc(input.steer * 127 / 4) * 4, -128, 124);
 car.thr += clamp(thrReq - car.thr, -16, 16);
 const bi = car.brk >> 5;
 const bd = brkReq - car.brk;
 car.brk += bd > 0 ? Math.min(bd, d.brakeInc[bi]) : -Math.min(-bd, d.brakeDec[bi]);
 if ((steerReq > 0 && car.steer >= 0) || (steerReq < 0 && car.steer <= 0)) car.steer += clamp(steerReq - car.steer, -d.turnIn, d.turnIn);
 else if (car.steer) car.steer += clamp(-car.steer, -d.turnOut, d.turnOut);
 car.hand = input.hand ? 1 : 0;
 car.rev = input.reverse ? 1 : 0;
 car.steerReq = steerReq;
}

function gearbox(car: ArcadeState, thrN: number): void {
 const d = car.data;
 if (car.shift > 0) car.shift--;
 const g = car.gear;
 let want = g;
 // Reverse is a held button, not a brake-at-standstill rule: it engages only when the
 // car is (nearly) stopped and drops back to first as soon as the button is released.
 const wantRev = car.rev > 0 && car.vFwd < 0.5;
 if (g === 0) {
  if (!car.rev) want = 2;
 } else if (g === 1) want = wantRev ? 0 : car.thr > 0 ? 2 : 1;
 else if (wantRev && g === 2) want = 0;
 else {
  const up = Math.min(g + 1, d.gears - 1);
  const dn = g > 2 ? g - 1 : g;
  const dn2 = g > 3 ? g - 2 : g;
  const rpmAt = (k: number) => trunc(car.speed * d.ratio[k]);
  const cur = rpmAt(g), rDn = rpmAt(dn), rDn2 = rpmAt(dn2);
  if (thrN > 0.9) {
   if (cur > d.redline - 500 && g < d.gears - 1) want = up;
   else if (rDn2 < d.redline - 1500 && dn2 !== g) want = dn2;
   else if (rDn < d.redline - 1500 && dn !== g) want = dn;
  } else if (Math.abs(cur) > d.redline) want = up;
  else if (rDn < d.redline - 1500 && dn !== g) want = dn;
 }
 if (want !== g) {
  car.prevGear = g;
  car.gear = want;
  car.shift = d.shiftTicks;
 }
}

function engine(car: ArcadeState, thrN: number, brkN: number, surf: number, roadCurve: number): number {
 const d = car.data;
 const g = car.gear;
 const ratio = d.ratio[g] || d.ratio[car.prevGear];
 const thrRpm = trunc(thrN * d.redline);
 let brakeCap = 2 * d.maxBrake;
 if (Math.abs(car.speed) < 10) brakeCap *= 0.75;
 const capA = Math.abs(car.skid) >= 3 ? brakeCap / 2 : brakeCap;
 const lockRef = brakeCap * 0.8;
 const wheelRpm = trunc(car.vFwd * ratio);
 let braking = false;
 if (wheelRpm < 0) {
  braking = true;
  car.brk = 255;
  brkN = 1;
  if (car.smoke < 30) car.smoke = Math.min(40, car.smoke + 4);
  if (g === 0 && car.vFwd > 10) car.skid = car.steer > 16 ? 4 : car.steer < -16 ? -4 : car.skid;
 }
 if (g === 2 && car.prevGear === 1) { car.rpm = thrRpm; car.prevGear = 2; }
 if (car.skid === 1) car.skid = 0;
 const diff = car.rpm - wheelRpm;
 if (diff > 1500 && g <= 4 && g >= 2 && thrN > 0.5 && Math.abs(car.skid) !== 4) {
  car.skid = 1;
  if (g === 2 && car.speed > 5) car.skid = car.steer > 32 ? 2 : car.steer < -32 ? -2 : 1;
  const drop = trunc(((256 - car.thr) * 20) / 256) + 10 + (g === 3 ? 45 : g === 4 ? 75 : 0);
  car.rpm -= trunc(drop * surf);
  car.smoke = 40;
 } else if (Math.abs(diff) > 200) car.rpm -= sgn(diff) * 200;
 else car.rpm = wheelRpm;
 let a = 0;
 if (car.rpm > d.redline && g < d.gears - 1) {
  a = -torqueAt(d, d.redline) * car.apn[g] / 2;
  if (64 * surf < car.steer) car.skid = 3;
  else if (64 * surf < -car.steer) car.skid = -3;
 } else if (car.shift > 0) a = 0;
 else if (car.thr > 0) {
  const dd = thrRpm - wheelRpm;
  if (Math.abs(dd) >= 250) {
   if (thrRpm > wheelRpm) {
    a = torqueAt(d, car.rpm) * car.apn[g] * 1.5 * thrN;
    const as = Math.abs(car.skid);
    if (as === 3) a *= Math.min(3, 1 + 2 * Math.abs(car.yawRate) * thrN) * surf;
    else if (as === 1 || as === 2) a *= 0.5;
    else a *= surf;
   } else a = -torqueAt(d, car.rpm) * car.apn[g] * d.gasOff;
  } else a = dd / ratio;
 } else {
  a = -0.1 * Math.abs(car.vFwd) * torqueAt(d, car.rpm) * car.apn[g] * d.gasOff;
  if (car.vFwd < 0 && g < 2) a = -a;
 }
 if (car.hand) a /= 2;
 car.lock = 0;
 if (car.brk > 0) {
  if (car.hand && car.steer) {
   car.skid = car.steer > 0 ? 4 : -4;
   car.brk = 128;
   brkN = 0.5;
  } else if (car.brk > 32 && 64 * surf < Math.abs(car.steer) && sgn(car.yawRate) === sgn(car.steer) && Math.abs(roadCurve) > 25) car.skid = 3 * sgn(car.steer);
  const bdec = brkN * capA * (car.vFwd >= 0 ? 1 : -1);
  a -= bdec;
  if (-surf * (lockRef + 2) > a && g <= 3 && car.speed > 0.2) { car.lock++; car.smoke = Math.min(40, car.smoke + 4); }
  if (-surf * lockRef > -Math.abs(bdec) && car.speed > 0.2) { if (car.skid !== 1) car.lock += 2; car.smoke = Math.min(40, car.smoke + 4); }
  braking = true;
 }
 const dRpm = trunc(a * ratio) >> 5;
 let rpmNew = wheelRpm + dRpm;
 if (!braking) {
  if (dRpm < 0 && wheelRpm > 0 && rpmNew < 0) rpmNew = 0;
  if (dRpm > 0 && wheelRpm < 0 && rpmNew > 0) rpmNew = 0;
 }
 if (dRpm > 0 && rpmNew >= d.redline) rpmNew = d.redline;
 if (dRpm <= 0 && rpmNew < -d.redline) rpmNew = -d.redline;
 car.acc = a;
 return rpmNew / ratio;
}

function steering(car: ArcadeState, thrN: number, brkN: number, gLat: number, roadCurve: number): void {
 const d = car.data;
 const av = Math.abs(car.vFwd);
 let auth = d.steerAccel / 64;
 if (av < 5) auth *= av * 0.2;
 else if (av > 20) auth /= av * (car.thr < 128 ? d.lowTurn : d.highTurn) + 1;
 if (car.lock === 1 || car.lock === 3) auth /= 4;
 let A = auth * 0.75;
 const ac = Math.abs(roadCurve);
 if (ac > 64 && car.skid === 3 * sgn(roadCurve)) {
  A = ac > 128 ? auth * (1 + (ac - d.slideAssist) / 512) : auth * clamp(0.5 + (ac - d.slideAssist / 2) / 128, 0.75, 1);
  A *= clamp(av / car.top[4], 0.5, 1);
 }
 const steerEff = clamp(car.steer + Math.floor(gLat * 0.19 * 16), -127, 127);
 let yaw = (auth / 128) * steerEff;
 if (car.vFwd < 0) yaw = -yaw;
 const s = car.skid, as = Math.abs(s);
 if (as >= 2 && s !== 5) {
  const f = as === 4 ? clamp(car.speed * 0.1, 0, 1) : Math.min(1, brkN + (car.gear !== 1 ? thrN : 0));
  let e = f * A * SK1[as];
  if (sgn(steerEff) !== sgn(s)) { if (as === 2) e = 0; }
  else if (as === 2) e *= clamp((car.steer + 1) / 128, -1, 1);
  const target = yaw + sgn(s) * e;
  let rate = SK2[as];
  if ((s === 2 && car.steerReq > 0) || (s === -2 && car.steerReq < 0)) rate /= 2;
  yaw = car.yawRate + clamp(target - car.yawRate, -rate, rate);
 }
 if (av < 1 && car.thr > 50 && car.gear !== 1 && Math.abs(car.vFwd) > 0.02) {
  yaw = (car.vFwd > 0 ? 1 : -1) * car.steer / 256;
  car.vFwd = 0;
 }
 car.yawRate = yaw;
}

function slide(car: ArcadeState, thrN: number, brkN: number, gLat: number): void {
 const d = car.data;
 let s = car.skid;
 const yaw = car.yawRate;
 if (Math.abs(s) === 3 && (car.speed < 15 || car.rpm < 3000)) s = 0;
 if (s === 0 || s === 5) {
  const lp = Math.abs(trunc(car.speed) ** 2 * Math.floor(yaw * 128) / 65536);
  s = 0;
  if (car.thr < 64) {
   const m = 1 - Math.max(0, lp - d.pushFactor);
   if (m < 0.6) { s = 5; car.smoke = Math.min(40, car.smoke + 2); }
  }
 }
 const as = Math.abs(s);
 let rate = SL1[as];
 if (car.speed < 5 ? car.thr < 32 : s === 0 || car.thr === 0) rate *= 2;
 let flag = false;
 if ((s === 3 && yaw <= 0.02) || (s === -3 && yaw > -0.02)) {
  flag = true;
  rate = (thrN > 0.75 ? 3 : 4) * SL1[as];
  if ((s === -3 && car.vLat < 0.3) || (s === 3 && car.vLat > -0.3)) { s = 0; car.vLat = 0; }
  else car.yawRate = 0;
 }
 let T = 0;
 if (as >= 2 && s !== 5) {
  T = -(SL2[as] * d.slideMult * car.yawRate * car.speed);
  if (car.speed < 5) T /= 2;
  if (thrN + brkN < 0.1) rate *= 2;
  if (Math.abs(car.vFwd) < 5) T = Math.abs(car.vFwd) * 0.2;
 }
 T += Math.abs(T) * gLat * 0.1;
 car.vLat += clamp(T - car.vLat, -rate, rate);
 if (Math.abs(car.vLat) < 0.2 && !flag) {
  if (s !== 5 && s !== 1) s = 0;
  car.vLat = 0;
 } else if (as === 2 && thrN < 0.5) s = 0;
 else if (as > 2 && as !== 5 && car.rpm < 3000) s = 0;
 car.skid = s;
}

/** One 1/64 s tick. `up` is the ground normal; yaw 0 faces -Z, +steer/+yawRate = right turn.
 *  Reverse is selected by holding `reverse` at a standstill; throttle then drives backwards. */
export function tickArcade(car: ArcadeState, input: ArcadeInput, up: Vec3, surf = 1, roadCurve = 0, slopeMode = 1): void {
 inputs(car, input);
 const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
 let rx = -fz * up.y, ry = fz * up.x - fx * up.z, rz = fx * up.y;
 let l = Math.hypot(rx, ry, rz) || 1;
 rx /= l; ry /= l; rz /= l;
 let wx = up.y * rz - up.z * ry, wy = up.z * rx - up.x * rz, wz = up.x * ry - up.y * rx;
 l = Math.hypot(wx, wy, wz) || 1;
 wx /= l; wy /= l; wz /= l;
 const gLat = -G * ry, gFwd = -G * wy;
 const latP = rx * car.vx + ry * car.vy + rz * car.vz;
 car.vFwd = wx * car.vx + wy * car.vy + wz * car.vz;
 const vFwdOld = car.vFwd;
 car.speed = Math.hypot(latP, car.vFwd);
 const thrN = Math.min(1, (car.thr + 1) / 248);
 gearbox(car, thrN);
 let brkN = Math.min(1, (car.brk + 1) / 248);
 const vFwdNew = engine(car, thrN, brkN, surf, roadCurve);
 brkN = Math.min(1, (car.brk + 1) / 248);
 steering(car, thrN, brkN, gLat, roadCurve);
 slide(car, thrN, brkN, gLat);
 car.vFwd = vFwdNew;
 const over = Math.abs(car.yawRate) * TAU * Math.abs(car.vFwd) - TURN_GRIP;
 if (over > 0) car.vFwd -= sgn(car.vFwd) * over * TICK;
 if (car.vFwd > 0 && car.vFwd < 15) car.vLat = clamp(car.vLat, -car.vFwd, car.vFwd);
 // Slope gravity (sub_4401c0).
 const dv = slopeGravity(gFwd, vFwdOld, slopeMode);
 if (dv !== 0) car.vFwd += dv;
 car.vx = rx * car.vLat + wx * car.vFwd;
 car.vy = ry * car.vLat + wy * car.vFwd;
 car.vz = rz * car.vLat + wz * car.vFwd;
 car.yaw -= car.yawRate * TAU * TICK;
 car.x += car.vx * TICK;
 car.z += car.vz * TICK;
 const a1 = Math.abs(car.vLat), a2 = Math.abs(car.vFwd);
 car.speed = Math.max(a1, a2) + Math.min(a1, a2) / 4;
 if (car.smoke > 0) car.smoke = Math.max(0, car.smoke - 0.5);
}

/** Wall response (sub_4575f0 + sub_42d030): no bounce, tangential loss, heading pulled parallel. Returns |vn|/2. */
export function impactArcade(car: ArcadeState, nx: number, nz: number): number {
 const vn = car.vx * nx + car.vz * nz;
 if (vn >= 0) return 0;
 const tx = -nz, tz = nx;
 let vt = car.vx * tx + car.vz * tz;
 if (vt > 5) vt = Math.max(0, vt + vn * 0.75);
 else if (vt < -5) vt = Math.min(0, vt - vn * 0.75);
 car.vx = tx * vt;
 car.vz = tz * vt;
 if (car.vy > 0) car.vy = 0;
 let fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
 const dir = fx * tx + fz * tz >= 0 ? 1 : -1;
 if (fx * tx * dir + fz * tz * dir > 0.6) {
  const k = Math.min(0.75, Math.abs(car.vFwd) / 16);
  fx += k * (tx * dir - fx);
  fz += k * (tz * dir - fz);
  car.yaw = Math.atan2(-fx, -fz);
 }
 return -vn / 2;
}
