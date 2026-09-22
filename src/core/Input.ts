import type { CarInput } from '../physics/types.js';

const CONTROL_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyX', 'KeyZ', 'KeyC', 'ShiftLeft', 'ShiftRight']);

/** Raw keyboard and touch input; it knows nothing about game rules. */
export class Input {
 private readonly keys = new Set<string>();
 private readonly touch = new Set<string>();
 enabled = true;
 /** When this returns true the key is not tracked at all (pause menu focus keys). */
 gate?: (event: KeyboardEvent) => boolean;
 onPress?: (code: string) => void;
 onRelease?: (code: string) => void;

 constructor() {
  addEventListener('keydown', event => {
   if (!this.enabled || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
   if (this.gate?.(event)) return;
   if (CONTROL_CODES.has(event.code)) event.preventDefault();
   if (!event.repeat) this.onPress?.(event.code);
   this.keys.add(event.code);
  });
  addEventListener('keyup', event => {
   this.keys.delete(event.code);
   this.onRelease?.(event.code);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
   const control = button.dataset.control!;
   button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.touch.add(control); };
   button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => this.touch.delete(control);
  });
 }

 clear() { this.keys.clear(); this.touch.clear(); }

 controls(): CarInput {
  const key = (code: string) => this.keys.has(code), pad = (code: string) => this.touch.has(code);
  return {
   throttle: +(key('KeyW') || key('ArrowUp') || pad('throttle')),
   brake: +(key('KeyS') || key('ArrowDown') || pad('brake')),
   steer: +(key('KeyD') || key('ArrowRight') || pad('right')) - +(key('KeyA') || key('ArrowLeft') || pad('left')),
   handbrake: key('Space'),
   reverse: key('ShiftLeft') || key('ShiftRight') || pad('reverse'),
  };
 }

 /** -1 look left, +1 look right. */
 peek(): number { return +this.keys.has('KeyC') - +this.keys.has('KeyZ'); }

 /** Look back (X). */
 backView(): boolean { return this.keys.has('KeyX'); }
}
