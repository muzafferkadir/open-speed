/** Persistent game settings, saved to localStorage so they survive reloads
 *  (like a cookie). Values are read on boot and written on every change. */
export interface GameSettings {
 music: number; // 0-100
 sfx: number;   // 0-100
 language: string;
 units: string;
 map: string;
 /** Selected car id; survives the reload a track switch triggers. */
 vehicle: string;
 /** How the scene is drawn: see RenderStyle.STYLES. */
 style: string;
 /** The grade laid over the finished picture: see Postprocessing.LOOKS. */
 look: string;
 /** How the renderer lands its highlights: see Stage.TONES. */
 tone: string;
}

const KEY = 'open-speed:settings';

const DEFAULTS: GameSettings = {
 music: 70,
 sfx: 80,
 language: 'English',
 units: 'Metric (km/h)',
 map: 'last-resort',
 vehicle: '',
 style: 'cartoon',
 look: 'remaster',
 tone: 'aces',
};

export class Settings {
 readonly values: GameSettings;

 constructor() {
  this.values = this.load();
 }

 private load(): GameSettings {
  try {
   const raw = localStorage.getItem(KEY);
   if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
   // private mode / disabled storage — fall back to defaults
  }
  return { ...DEFAULTS };
 }

 set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
  this.values[key] = value;
  try {
   localStorage.setItem(KEY, JSON.stringify(this.values));
  } catch {
   // ignore write failures; settings still apply for this session
  }
 }
}
