// Race start: a two-second camera sweep around the parked car, then a 3-2-1 light countdown.
// Controls and the AI stay frozen until GO. Owns the #countdown overlay.

import { $ } from '../core/dom.js';
import type { EngineAudio } from './EngineAudio.js';

export const INTRO_SECONDS = 2;
export const COUNT_SECONDS = 3;
const GO_SECONDS = 0.9;
const TOTAL = INTRO_SECONDS + COUNT_SECONDS;

/** Light pattern per countdown step: [red, yellow, green]. */
const LIGHTS: Record<string, [boolean, boolean, boolean]> = {
 '3': [true, false, false],
 '2': [true, true, false],
 '1': [true, true, false],
 'GO!': [false, false, true],
};

export class StartSequence {
 private t = 0;
 private shown = '';
 private readonly root = $('countdown');
 private readonly text = $('countdown-text');
 private readonly lights = Array.from(this.root.querySelectorAll('i'));

 constructor(private readonly audio: EngineAudio) {
  this.root.hidden = false;
  this.show('');
 }

 /** True once the cars are released (the GO flash may still be fading). */
 get released(): boolean { return this.t >= TOTAL; }
 /** True when the overlay has finished and the sequence can be dropped. */
 get done(): boolean { return this.t >= TOTAL + GO_SECONDS; }
 /** 0..1 over intro + countdown, for the camera sweep. */
 get progress(): number { return Math.min(1, this.t / TOTAL); }

 update(dt: number): void {
  this.t += dt;
  const label = this.t < INTRO_SECONDS ? '' : this.t < TOTAL ? String(Math.ceil(TOTAL - this.t)) : 'GO!';
  if (label !== this.shown) {
   this.show(label);
   if (label) this.audio.beep(label === 'GO!' ? 880 : 440, label === 'GO!' ? .5 : .15);
  }
  if (this.done) this.root.hidden = true;
 }

 dispose(): void { this.root.hidden = true; }

 private show(label: string) {
  this.shown = label;
  this.text.textContent = label;
  this.text.classList.remove('pop');
  if (label) { void this.text.offsetWidth; this.text.classList.add('pop'); }
  const on = LIGHTS[label] ?? [false, false, false];
  this.lights.forEach((light, i) => light.classList.toggle('on', on[i]));
  this.root.classList.toggle('go', label === 'GO!');
 }
}
