import * as THREE from 'three';
import vehicles from '../data/vehicles.json';
import { loadMap, loadMapIndex, type GameMap, type MapEntry } from '../track/maps.js';
import { mapContext } from '../track/mapContext.js';
import { ChaseCamera } from '../game/ChaseCamera.js';
import { CHECK_EVERY, HOLD, skyBlocked, wantsLight } from '../game/headlights.js';
import { Occluders } from '../game/occlusion.js';
import { EngineAudio } from '../game/EngineAudio.js';
import { Garage } from '../game/Garage.js';
import { PLATFORM_TOP } from '../game/GarageRoom.js';
import { Music } from '../game/Music.js';
import { LOOKS, Postprocessing } from '../game/Postprocessing.js';
import { DEFAULT_STYLE, RenderStyle, STYLES, type Style } from '../game/RenderStyle.js';
import { StartSequence } from '../game/StartSequence.js';
import type { VehicleDesign } from '../game/types.js';
import { VehicleView } from '../game/VehicleView.js';
import { Car, RIDE_HEIGHT } from '../physics/Car.js';
import type { CarState, VehicleProfile, World } from '../physics/types.js';
import { cloneCarState, copyCarState } from '../physics/types.js';
import { RenderScale } from './RenderScale.js';
import { Hud } from '../ui/Hud.js';
import { raceStatus, Results } from '../ui/Results.js';
import { bindSettings } from '../ui/SettingsPanel.js';
import { debugLaps, debugSpawn, exposeDebug, type Spawn } from './Debug.js';
import { buildDriveStage, disposeDriveStage, followSun, type DriveStage } from './DriveStage.js';
import { $, hideLoadingScreen, showLoadingScreen } from './dom.js';
import { Input } from './Input.js';
import { Settings, type GameSettings } from './Settings.js';
import { applyTone, createRenderer, TONES, type Tone } from './Stage.js';
import { createWorld, startYaw } from './Track.js';

const STEP = 1 / 64;
/** Stand-in for a stage that has no track yet; nothing blocks the sun on it. */
const EMPTY_OCCLUDERS = new Occluders();
const MAX_FRAME = 0.1;
const FRAME_HISTORY = 600;
const TOP_SPEED_NORM = 120;
const DEFAULT_MAP = 'last-resort';
const LOOK_KEYS = new Set(['KeyZ', 'KeyC', 'KeyX']);

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Game {
 private readonly designs = vehicles as VehicleDesign[];
 private readonly input = new Input();
 private readonly vehicleView = new VehicleView();
 private readonly cameraRig = new ChaseCamera();
 private readonly renderScale = new RenderScale(Math.min(devicePixelRatio, 2));
 /** The grade styles the debug tools can switch between; see Postprocessing.LOOKS. */
 readonly looks = LOOKS;
 /** The shading styles; see RenderStyle.STYLES. */
 readonly styles = STYLES;
 /** The tone mappings; see Stage.TONES. */
 readonly tones = TONES;

 /** Switches how the renderer lands its highlights. */
 setTone(tone: Tone): void { applyTone(this.renderer, tone); }
 private readonly renderStyle = new RenderStyle();
 private tuning = false;
 private style: Style = DEFAULT_STYLE;

 /** Brings up the look tuning panel on `?tune`, so the values are chosen by eye. */
 private openTunePanel(): void {
  // The panel needs the composer, which is rebuilt with the stage; mount it once, on the first.
  if (this.tuning || !this.composer || !new URLSearchParams(location.search).has('tune')) return;
  this.tuning = true;
  void import('../debug/TunePanel.js').then(({ mountTunePanel }) => {
   mountTunePanel(this.composer!, this.renderStyle, STYLES, LOOKS, TONES, tone => this.setTone(tone as Tone));
   (window as unknown as { __tuneApply?: (fn: (name: Style) => void) => void }).__tuneApply?.(name => this.setStyle(name));
  });
 }

 /** Redraws the whole scene in one of {@link STYLES}. */
 setStyle(style: Style): void {
  this.style = style;
  if (this.drive) this.renderStyle.apply(this.drive.stage.scene, style, this.vehicleView.group);
 }
 private headlightsOn = false;
 private shadeCheck = 0;
 private headlightHold = 0;
 private readonly hud = new Hud();
 private readonly results = new Results();
 private readonly audio = new EngineAudio();
 private readonly music = new Music();
 private readonly settings = new Settings();
 private readonly spawn?: Spawn = debugSpawn();

 private maps: MapEntry[] = [];
 private mapId = DEFAULT_MAP;
 private map!: GameMap;
 private world!: World;
 private drive?: DriveStage;
 private renderer!: THREE.WebGLRenderer;
 private composer?: Postprocessing;
 private garage!: Garage;

 /** Drive-scene views; undefined until the first start and rebuilt on a map switch. */
 private get race() { return this.drive?.race; }
 private get scene() { return this.drive?.stage.scene; }
 private get sun() { return this.drive!.stage.sun; }
 private get horizon() { return this.drive?.stage.horizon; }
 private get skids() { return this.drive!.skids; }
 private get minimap() { return this.drive!.minimap; }
 private get pauseMap() { return this.drive!.pauseMap; }

 private physics!: Car;
 private current!: CarState;
 private previous!: CarState;
 private readonly visualPosition = new THREE.Vector3();
 private visualYaw = 0;
 private startYaw = 0;
 private elapsed = 0;
 private accumulator = 0;
 private last = performance.now();
 readonly frameMs: number[] = [];
 private paused = true;
 private inGarage = true;
 private loading = false;
 private starting?: StartSequence;
 private vehicleIndex = 0;
 private readonly vehicleQueue: number[] = [];
 private mapRequest = 0;

 async start(): Promise<void> {
  await this.loadSavedMap();
  this.maps = await loadMapIndex().catch(() => [] as MapEntry[]);
  this.vehicleIndex = Math.max(0, this.designs.findIndex(design => design.id === this.settings.values.vehicle));
  this.resetPhysics();
  this.syncState();

  this.renderer = createRenderer($<HTMLCanvasElement>('scene'));
  this.createGarage();

  this.wireInput();
  this.wireUi();
  document.body.classList.add('in-garage');
  this.unlockMusicOnGesture();
  this.snapCamera();
  addEventListener('resize', () => this.resize());
  this.resize();
  $('message').textContent = '';

  this.garage.refresh(this.vehicleIndex);
  this.selectVehicle(this.vehicleIndex);
  exposeDebug(this, () => this.scene, this.cameraRig.camera, () => this.physics.state);
  this.last = performance.now();
  this.renderer.setAnimationLoop(this.frame);
 }

 /** The saved map is only fetched, never built: the drive world waits for the start button. */
 private async loadSavedMap(): Promise<void> {
  this.mapId = this.settings.values.map;
  try {
   await this.installMap(this.mapId);
  } catch {
   this.mapId = DEFAULT_MAP;
   await this.installMap(DEFAULT_MAP);
  }
 }

 /** Fetches a map JSON, builds its physics world and redraws the menu map. No 3D scene yet.
  *  A newer request supersedes an older one that is still fetching. */
 private async installMap(id: string): Promise<void> {
  const token = ++this.mapRequest;
  const map = await loadMap(id);
  if (token !== this.mapRequest) return;
  this.mapId = id;
  this.map = map;
  this.world = createWorld(map);
  this.startYaw = startYaw(this.world);
  const entry = this.maps.find(m => m.id === id);
  if (entry) this.garage?.showMapPreview(mapContext(map, this.world), entry, this.maps.indexOf(entry));
 }

 /** A fresh player car on the current world, at the start line. */
 private resetPhysics() {
  this.physics = new Car(this.profile(), this.world);
  this.physics.reset(this.world.circuit[0][0], this.world.circuit[0][1], this.startYaw);
 }

 private createGarage() {
  const { circuit, roadLines, tile, terrain } = mapContext(this.map, this.world);
  this.garage = new Garage(
   this.vehicleView, this.renderer.domElement, this.designs, index => this.selectVehicle(index), circuit,
   this.renderer.capabilities.getMaxAnisotropy(), this.renderer, roadLines, tile, terrain, this.maps, this.mapId,
   id => this.pickMap(id));
 }

 private profile(): VehicleProfile {
  const design = this.designs[this.vehicleIndex];
  return { ...design.physics, ...design.dimensions };
 }

 private syncState() {
  // Two distinct buffers: the render loop interpolates between them and simulate() swaps them,
  // so they must never be the same object.
  this.previous = cloneCarState(this.physics.state);
  this.current = cloneCarState(this.physics.state);
  this.visualPosition.set(this.current.x, this.current.y - RIDE_HEIGHT, this.current.z);
  this.visualYaw = this.current.yaw;
 }

 private snapCamera() {
  this.cameraRig.snap(this.visualPosition, this.visualYaw, this.input, this.current.speed / 3.6);
 }

 private unlockMusicOnGesture() {
  const unlock = () => this.music.unlock();
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });
 }

 private wireInput() {
  this.input.enabled = false;
  this.input.gate = event => {
   if (event.code === 'Tab' && this.paused) {
    this.cycleMenuFocus(event);
    return true;
   }
   return this.paused && (event.code === 'Space' || event.code === 'Enter');
  };
  this.input.onPress = code => {
   if (code === 'KeyR') this.resetRun();
   if (code === 'KeyV') this.cameraRig.cycle();
   if (code === 'Escape') this.togglePause();
   if (LOOK_KEYS.has(code)) this.snapCamera();
  };
  this.input.onRelease = code => {
   if (LOOK_KEYS.has(code)) this.snapCamera();
  };
  const abandon = () => {
   this.input.clear();
   this.paused = true;
   this.snapCamera();
   this.updateMenu();
  };
  addEventListener('blur', abandon);
  document.addEventListener('visibilitychange', () => { if (document.hidden) abandon(); });
 }

 private cycleMenuFocus(event: KeyboardEvent) {
  const items = Array.from($('menu').querySelectorAll<HTMLElement>('button:not(:disabled),summary'));
  const index = items.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
 }

 private wireUi() {
  $('drive').onclick = () => this.startDrive();
  $('results-again').onclick = () => this.resetRun();
  $('results-menu').onclick = () => this.enterGarage();
  $('reset').onclick = () => this.resetRun();
  $('pause').onclick = () => this.togglePause();
  $('menu-toggle').onclick = () => this.togglePause();
  document.querySelectorAll<HTMLButtonElement>('[data-garage-tab]').forEach(button => {
   button.onclick = () => this.setGarageTab(button.dataset.garageTab!);
  });
  bindSettings(this.settings, (key, value) => this.applySetting(key, value));
  const camera = $('camera');
  camera.onclick = () => this.cameraRig.cycle();
  camera.textContent = 'Camera · V';
  camera.title = 'V: change camera · Z: look left · C: look right · X: look back (hold)';
  const sound = $('sound');
  sound.textContent = 'Sound on';
  sound.onclick = async () => {
   const on = await this.audio.toggle();
   this.music.setMuted(!on);
   sound.textContent = on ? 'Sound on' : 'Sound off';
  };
  const exit = document.createElement('button');
  exit.textContent = 'Exit to menu';
  exit.onclick = () => this.enterGarage();
  document.querySelector('#menu .actions')!.append(exit);
 }

 private applySetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
  if (key === 'style') this.setStyle(String(value) as Style);
  if (key === 'look') this.composer?.setLook(String(value));
  if (key === 'tone') this.setTone(String(value) as Tone);
  if (key === 'music') this.music.setVolume(Number(value) / 100);
  else if (key === 'sfx') this.audio.setVolume(Number(value) / 100);
 }

 /** Map tab pick: fetch the plan and remember the choice; the drive world is built on start. */
 private async pickMap(id: string) {
  if (id === this.mapId) return;
  try {
   await this.installMap(id);
  } catch (error) {
   console.warn('Map failed to load', error);
   return;
  }
  // A superseded fetch never lands, so only the map that actually installed is saved.
  if (this.mapId === id) this.settings.set('map', id);
 }

 /** Queued, so a burst of carousel clicks each load in turn and the last one wins. */
 private selectVehicle(index: number) {
  if (index === this.vehicleIndex && this.vehicleView.loaded) return;
  this.vehicleQueue.push(index);
  if (!this.loading) void this.loadVehicles();
 }

 private async loadVehicles() {
  this.loading = true;
  while (this.vehicleQueue.length) {
   const index = this.vehicleQueue.pop()!; // the latest pick wins
   this.vehicleQueue.length = 0;
   this.drive?.skids.reset();
   $<HTMLButtonElement>('drive').disabled = true;
   this.garage.setStatus('Loading car…');
   try {
    await this.vehicleView.load(this.designs[index]);
    this.vehicleIndex = index;
    this.settings.set('vehicle', this.designs[index].id);
    this.garage.refresh(index);
    this.garage.setStatus('');
    hideLoadingScreen();
   } catch (error) {
    console.warn('Vehicle GLB failed to load', error);
    this.garage.setStatus('Car failed to load. Pick another one.');
    if (!this.vehicleView.loaded) hideLoadingScreen();
   }
  }
  this.loading = false;
  $<HTMLButtonElement>('drive').disabled = !this.vehicleView.loaded;
 }

 private setGarageTab(tab: string) {
  this.garage.setTab(tab);
  document.querySelectorAll<HTMLElement>('[data-garage-view]').forEach(view => {
   view.classList.toggle('is-active', view.dataset.garageView === tab);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-garage-tab]').forEach(button => {
   const active = button.dataset.garageTab === tab;
   button.classList.toggle('is-active', active);
   button.setAttribute('aria-pressed', String(active));
  });
 }

 private async startDrive() {
  if (this.loading || !this.vehicleView.loaded) return;
  this.loading = true;
  showLoadingScreen();
  try {
   this.resetPhysics();
   await this.ensureDriveStage();
  } catch (error) {
   console.warn('Track failed to load', error);
   $('message').textContent = 'Track failed to load. Pick another one.';
   this.loading = false;
   hideLoadingScreen();
   return;
  }
  this.race?.setPlayer(this.physics);
  this.inGarage = false;
  this.music.setScene('race');
  this.garage.exit();
  this.drive!.stage.scene.add(this.vehicleView.group);
  // The style has to be laid on after the car joins the scene: its outline is built from the
  // car's own meshes, and those arrive with the model.
  this.setStyle(this.style);
  await this.warmUp();
  document.body.classList.remove('in-garage');
  this.paused = false;
  this.input.enabled = true;
  this.resetRun();
  this.updateMenu();
  this.loading = false;
  hideLoadingScreen();
 }

 /** Builds the drive scene for the picked map, or reuses the one already built. */
 private async ensureDriveStage(): Promise<void> {
  if (this.drive?.mapId === this.mapId) return;
  if (this.drive) {
   this.drive.stage.scene.remove(this.vehicleView.group);
   disposeDriveStage(this.drive);
   this.cameraRig.setOccluders(new Occluders());
   this.drive = undefined;
  }
  const drive = await buildDriveStage(this.renderer, this.map, this.world, this.physics, debugLaps());
  this.drive = drive;
  this.cameraRig.setOccluders(drive.track.occluders ?? new Occluders());
  // The composer is bound to a scene, so it is rebuilt with the stage.
  this.composer = new Postprocessing(this.renderer, drive.stage.scene, this.cameraRig.camera);
  this.composer.setSize(innerWidth, innerHeight);
  this.composer.setCutouts(drive.stage.scene);
  this.composer.setHaze((drive.stage.scene.fog as THREE.FogExp2).color);
  // The grade is rebuilt with the stage, so the saved choice has to be laid on again.
  this.composer.setLook(String(this.settings.values.look));
  this.openTunePanel();
 }

 /**
  * The last of the loading work, once the scene is final: the car has joined it and the shading
  * style has swapped every material and built the outline hulls, so the programs compiled while
  * building the stage are not the ones that will be drawn. Compiling again here, and running one
  * frame through the composer to build the post passes and the first shadow map, keeps that cost
  * under the loading screen instead of in the opening camera sweep.
  */
 private async warmUp(): Promise<void> {
  const drive = this.drive;
  if (!drive) return;
  await this.renderer.compileAsync(drive.stage.scene, this.cameraRig.camera);
  this.composer?.render(0, 0);
 }

 private enterGarage() {
  this.drive?.skids.reset();
  this.stopStartSequence();
  this.results.hide();
  this.inGarage = true;
  this.music.setScene('menu');
  this.paused = true;
  this.input.enabled = false;
  this.input.clear();
  $('menu').hidden = true;
  this.setGarageTab('my-ride');
  document.body.classList.add('in-garage');
  this.garage.enter();
  this.placeOnPlatform();
  this.visualPosition.set(0, 0, 0);
  this.visualYaw = 0;
  this.vehicleView.resetPose();
 }

 private resetRun() {
  this.drive?.skids.reset();
  if (this.race && !this.spawn) this.race.reset();
  else {
   const spawn = this.spawn ?? { x: this.world.circuit[0][0], z: this.world.circuit[0][1], yaw: this.startYaw };
   this.physics.reset(spawn.x, spawn.z, spawn.yaw);
  }
  this.elapsed = 0;
  this.accumulator = 0;
  this.syncState();
  this.input.clear();
  this.snapCamera();
  this.stopStartSequence();
  this.starting = new StartSequence(this.audio);
  this.results.hide();
 }

 private stopStartSequence() {
  this.starting?.dispose();
  this.starting = undefined;
 }

 private togglePause() {
  if (this.inGarage) return;
  this.paused = !this.paused;
  this.input.clear();
  this.updateMenu();
 }

 private updateMenu() {
  if (this.inGarage) return;
  $('menu').hidden = !this.paused;
  $('menu-toggle').setAttribute('aria-expanded', String(this.paused));
  $(this.paused ? 'pause' : 'menu-toggle').focus();
 }

 private resize() {
  this.renderer.setSize(innerWidth, innerHeight);
  this.composer?.setSize(innerWidth, innerHeight);
  this.cameraRig.setAspect(innerWidth / innerHeight);
  this.garage.setAspect(innerWidth / innerHeight);
 }

 private placeOnPlatform() {
  this.vehicleView.group.position.set(0, PLATFORM_TOP, 0);
  this.vehicleView.group.rotation.set(0, 0, 0);
 }

 private readonly frame = (now: number) => {
  const delta = now - this.last;
  const dt = Math.min(delta / 1000, MAX_FRAME);
  this.last = now;
  this.recordFrame(delta);
  if (this.inGarage) this.renderGarage(dt);
  else this.renderDrive(dt);
 };

 /** Steps the render resolution when the frames stop fitting the budget, and back up when they do. */
 private adaptResolution(delta: number) {
  // Not during the opening sweep: those frames carry the last of the loading work, so they read as
  // slow, and a resize there is a stutter in the one shot the player watches without driving.
  if (this.starting) return;
  const ratio = this.renderScale.sample(delta);
  if (ratio === null) return;
  this.renderer.setPixelRatio(ratio);
  this.composer?.setPixelRatio(ratio);
  this.renderer.setSize(innerWidth, innerHeight);
  this.composer?.setSize(innerWidth, innerHeight);
 }

 private recordFrame(delta: number) {
  this.adaptResolution(delta);
  this.frameMs.push(delta);
  if (this.frameMs.length > FRAME_HISTORY) this.frameMs.splice(0, this.frameMs.length - FRAME_HISTORY);
 }

 private renderGarage(dt: number) {
  this.placeOnPlatform();
  this.garage.update(dt);
  this.audio.update(this.current.rpm, false);
  this.renderer.render(this.garage.scene, this.garage.camera);
 }

 private renderDrive(dt: number) {
  const held = this.advanceStart(dt);
  if (!this.paused && !held) this.simulate(dt);
  const alpha = this.paused ? 1 : this.accumulator / STEP;
  this.interpolate(alpha);
  this.vehicleView.setLamps(held || this.input.controls().brake > 0.5, this.current.gear < 0);
  this.updateHeadlights();
  this.updateRace(alpha, held);
  const speedNorm = Math.min(Math.abs(this.current.speed) / TOP_SPEED_NORM, 1);
  this.updateCamera(dt, held, speedNorm);
  this.hud.update(this.current, this.elapsed);
  this.skids.update(this.current, this.vehicleView.group, this.vehicleView.wheels, this.paused);
  this.horizon?.position.copy(this.cameraRig.camera.position);
  followSun(this.sun, this.vehicleView.group.position);
  this.audio.update(this.current.rpm, this.audio.enabled && !this.paused);
  this.drawMaps();
  if (!this.paused) for (const fall of this.drive?.track.falls ?? []) fall.update(dt);
  this.composer?.render(dt, speedNorm);
 }

 /** Headlights come on where the sun does not reach: the tunnel, the cave, the canyon. */
 private updateHeadlights() {
  if (this.shadeCheck-- > 0) return;
  this.shadeCheck = CHECK_EVERY;
  const occluders = this.drive?.track.occluders ?? EMPTY_OCCLUDERS;
  // The field drives the same road under the same roofs; one of them is read each time round.
  this.race?.updateHeadlights(occluders);
  const blocked = skyBlocked(this.vehicleView.group.position, occluders);
  const on = wantsLight(blocked, this.headlightsOn);
  if (on === this.headlightsOn) { this.headlightHold = 0; return; }
  // One reading is not a decision: a gantry overhead is not a tunnel.
  if (++this.headlightHold < HOLD) return;
  this.headlightHold = 0;
  this.headlightsOn = on;
  this.vehicleView.setHeadlights(on);
 }

 private advanceStart(dt: number): boolean {
  if (!this.paused && this.starting) {
   this.starting.update(dt);
   if (this.starting.done) this.starting = undefined;
  }
  return !!this.starting && !this.starting.released;
 }

 private simulate(dt: number) {
  this.accumulator += dt;
  while (this.accumulator >= STEP) {
   this.physics.step(this.input.controls(), STEP);
   this.race?.step(STEP);
   // The state the render loop has already passed becomes the buffer the new one is written into.
   const spare = this.previous;
   this.previous = this.current;
   this.current = copyCarState(spare, this.physics.state);
   this.elapsed += STEP;
   this.accumulator -= STEP;
  }
 }

 private interpolate(alpha: number) {
  const { previous: a, current: b } = this;
  this.visualPosition.set(
   THREE.MathUtils.lerp(a.x, b.x, alpha),
   THREE.MathUtils.lerp(a.y, b.y, alpha) - RIDE_HEIGHT,
   THREE.MathUtils.lerp(a.z, b.z, alpha));
  this.visualYaw = a.yaw + wrapAngle(b.yaw - a.yaw) * alpha;
  this.vehicleView.group.position.copy(this.visualPosition);
  this.vehicleView.group.rotation.y = this.visualYaw;
  this.vehicleView.applyPose(a, b, alpha);
 }

 private updateRace(alpha: number, held = false) {
  this.race?.render(alpha, held);
  $('race').textContent = raceStatus(this.race);
  if (this.race?.playerFinished) this.results.show(this.race);
 }

 private updateCamera(dt: number, held: boolean, speedNorm: number) {
  if (held) {
   this.cameraRig.cinematic(this.visualPosition, this.visualYaw, this.starting!.progress);
   return;
  }
  this.cameraRig.applySpeedKick(speedNorm);
  this.cameraRig.update(dt, this.visualPosition, this.visualYaw, this.input, this.current.speed / 3.6);
 }

 private drawMaps() {
  const dots = this.race?.others() ?? [];
  this.minimap.draw(this.current.x, this.current.z, this.visualYaw, this.current.speed, false, dots);
  if (this.paused) this.pauseMap.draw(this.current.x, this.current.z, 0, 0, false, dots);
 }
}
