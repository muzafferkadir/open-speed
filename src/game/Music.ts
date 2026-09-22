/** Background music: a looping menu track and a looping race track,
 *  crossfaded when the game switches between the garage and driving. */
type Scene = 'menu' | 'race';

export class Music {
 private readonly tracks: Record<Scene, HTMLAudioElement> = {
  menu: new Audio('/audio/menu.webm'),
  race: new Audio('/audio/race.webm'),
 };
 private current: Scene = 'menu';
 private started = false;
 private muted = false;
 private volume = .42; // ceiling at slider 100%
 private level = 1;    // slider 0-1
 private fades = new Map<HTMLAudioElement, number>();

 constructor() {
  for (const track of Object.values(this.tracks)) {
   track.loop = true;
   track.preload = 'auto';
   track.volume = 0;
  }
 }

 /** Browsers block autoplay until a user gesture — call this from the first one. */
 unlock() {
  if (this.started) return;
  this.started = true;
  this.play(this.current);
 }

 setScene(scene: Scene) {
  if (scene === this.current) return;
  const previous = this.tracks[this.current];
  this.current = scene;
  this.fade(previous, 0, () => previous.pause());
  if (this.started) this.play(scene);
 }

 setMuted(muted: boolean) {
  this.muted = muted;
  this.fade(this.tracks[this.current], this.target);
 }

 /** Sets the music level from a 0-1 slider value. */
 setVolume(level: number) {
  this.level = Math.min(1, Math.max(0, level));
  this.fade(this.tracks[this.current], this.target);
 }

 private get target() {
  return this.muted ? 0 : this.volume * this.level;
 }

 private play(scene: Scene) {
  const track = this.tracks[scene];
  track.play().catch(() => {}); // ignore autoplay rejection; a later gesture retries
  this.fade(track, this.target);
 }

 /** Linear volume ramp; only one ramp per track runs at a time. */
 private fade(track: HTMLAudioElement, target: number, done?: () => void) {
  const existing = this.fades.get(track);
  if (existing) clearInterval(existing);
  const step = (target - track.volume) / 22; // ~0.35s at 60fps-ish
  const id = window.setInterval(() => {
   const next = track.volume + step;
   const finished = step >= 0 ? next >= target : next <= target;
   track.volume = finished ? target : Math.min(1, Math.max(0, next));
   if (finished) {
    clearInterval(id);
    this.fades.delete(track);
    done?.();
   }
  }, 16);
  this.fades.set(track, id);
 }
}
