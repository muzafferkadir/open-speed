import vehicles from '../src/data/vehicles.json' with { type: 'json' };
import { Car, TICK } from '../src/physics/Car.ts';

export const profile = { ...vehicles[0].physics, ...vehicles[0].dimensions };

export const flatWorld = ({ hit = () => null, surfaceAt = () => 'road', heightAt = () => 0 } = {}) =>
 ({ heightAt, surfaceAt, hit, circuit: [[0, 0], [0, -100]] });

export const input = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: false, ...o });

export function newCar(world = flatWorld()) {
 const car = new Car(profile, world);
 car.reset(0, 0, 0);
 return car;
}

export function drive(car, controls, seconds) {
 for (let i = 0; i < Math.round(seconds / TICK); i++) car.step(controls, TICK);
 return car.state;
}
