import type { CarState } from '../physics/types.js';
import { $ } from '../core/dom.js';

/** Instrument panel: speed, rpm, gear, timer and the slide warning. */
export class Hud {
 update(state: CarState, elapsed: number) {
  $('speed-blur').style.opacity = String(Math.min(.28, Math.max(0, (Math.abs(state.speed) - 35) / 170) * .28));
  $('speed').textContent = Math.round(Math.abs(state.speed)).toString().padStart(3, '0');
  $('rpm').textContent = `${Math.round(state.rpm)} RPM`;
  $('gear').textContent = state.gear < 0 ? 'R' : state.gear === 0 ? 'N' : String(state.gear);
  $('revbar').style.width = `${Math.min(100, state.rpm / state.rpmMax * 100)}%`;
  $('grip').textContent = state.slipFront > .3 || state.slipRear > .3 ? 'SLIDING' : '';
  $('time').textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toFixed(1).padStart(4, '0')}`;
 }
}
