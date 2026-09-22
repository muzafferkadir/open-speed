import type { GameSettings, Settings } from '../core/Settings.js';

type Apply = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;

export function bindSettings(settings: Settings, apply: Apply) {
 document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(control => {
  const key = control.dataset.setting as keyof GameSettings;
  control.value = String(settings.values[key]);
  const output = control.parentElement?.querySelector('output');
  const update = (persist: boolean) => {
   const value = (control.type === 'range' ? Number(control.value) : control.value) as GameSettings[typeof key];
   if (output) output.textContent = `${control.value}%`;
   apply(key, value);
   if (persist) settings.set(key, value);
  };
  control.addEventListener('input', () => update(true));
  update(false);
 });
}
