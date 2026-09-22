# Open Speed

Three.js arcade racer. Reply in Turkish; code, comments and commits in English.
Never start the dev server unless asked for it in so many words.

## How the code is laid out

```
src/main.ts      bootstrap          src/debug/   the model.html viewer and the ?tune panel
src/core/        Game (64 Hz fixed step + render interpolation), Stage, DriveStage, Track, Input, Settings
src/game/        3D systems: VehicleView, Race, ChaseCamera, occlusion, headlights, Sky, Postprocessing, RenderStyle
src/ui/          screen UI: Hud, Minimap, Results, SettingsPanel
src/track/       track scenes: OvalScene, RoadScene, RoadProps, landmarks, waterfalls, mapContext
src/physics/     pure model: Arcade (driving), Car (world adapter), OvalWorld, RoadWorld, collision, AiDriver
src/data/        vehicles.json, arcade-cars.json — one source of truth each
assets/          the files the game loads; Vite's publicDir. Generated, never hand-edited
```

Dependency direction is one-way: `main → core → game/ui/track → physics`. `physics` imports nothing
above it and no three.js, which is why it runs under plain node in tests. A type import counts.

Two maps (`assets/maps/index.json`): `kind: 'oval'` (`OvalWorld`/`OvalScene`) and `kind: 'road'`
(`RoadWorld`/`RoadScene`, plus an `<id>-props.json` sidecar saying where real scenery replaces the
flat cut-out cards). Picking a map only fetches its JSON and redraws the plan view; the drive world
is built on the start button, behind the loading screen, and never reloads the page.

## Rules

- OOP, DRY, SOLID. A comment explains why, never what; if the code needs a what, rewrite the code.
- Physics runs on a fixed 64 Hz step (`TICK` in `src/physics/Arcade.ts`). Driving work goes in
  `src/physics/`, stays free of three.js, and comes with a test.
- Do not retune `Arcade.ts` constants by feel — tests pin them. Car parameters live in
  `arcade-cars.json`; a vehicle picks its set with `physics.arcade`.
- `assets/*.glb` are build outputs. Change the script or the source under `$OPEN_SPEED_SOURCE`
  (default `~/Dev/open-speed/build/source`, gitignored) and re-bake. Never edit a GLB by hand.
- Model standard: Y-up, sitting on the ground, local-X wheel axle, no runtime transform — steering on
  the Y pivot, rolling on the child X. Model, visual and physics data all live in `vehicles.json`.
- Wheels are marked by hand, never detected. `model.wheels` gives one cylinder per axle in the
  source's own coordinates — `along`/`across`/`height`, a radius and a tyre width — and the bake
  takes the faces whose centre is inside it. The body gives up exactly those faces and nothing
  else, so a bad mark can leave a hole but can never take a fender with it. One mark serves both
  wheels of an axle, mirrored, which is what keeps a pair the same size and the same height.
  `ONLY=<id> PREVIEW=1 npm run models` draws it: red is what turns, and the hole it leaves.
  Marking a new car: the tyre is the lowest thing at each wheel, so start from its contact patch,
  then open the radius until the red covers the tyre and stops at the arch.
- `wheels.style` fits a wheel modelled on its own (`<source>/wheels/<style>.glb`) into the marks
  instead of keeping the one the body was drawn with. A wheel asked for on its own comes back with
  the whole budget - 156k faces on a 4096 texture - where the same wheel inside a car gets 4k faces
  and the 2.5% of the atlas it happened to land on. The wheel is decimated once, in the bake, to
  its own budget; a car that carries one is simplified `bodyOnly` afterwards, because a pass over
  the whole car takes the wheel down with the body and collapsing a tread groove leaves a hole.
  Do not decimate a body to pay for its wheels - that was tried, and it cost more than the wheels
  were worth. Three styles cover the garage: `alloy-5` on the five closed-wheel cars, `slick-race`
  on the open-wheeler, `steel-cap` on the saloon. The asset can arrive pointing any way - the
  narrowest axis of a wheel is the one it turns about, and the face is the end whose geometry
  reaches the axle, so the bake reads both off the model and mirrors each wheel to face outward.
- Tripo's own part segmentation was tried on two of these cars and is not worth it: it finds the
  same wheels the marks do, to within 3 mm, but hands back 45 parts with 45 materials and 135
  textures, splits one wheel across tyre, rim and hub, triples the triangles, and gives the tyre
  512x512 of texture where its share of the car's own atlas is 656x656. It costs 40 credits a car.
- Simulation pauses in the garage. Controls belong in the menu; do not explain them on the drive HUD.
- Handling is an arcade model, not real-world car data. Say so rather than "fixing" it toward realism.
- Keep secrets out of the repo: read them from the environment under `bws run`.
- Not every asset is ours to ship. `assets/scenery/` is CC-BY and travels with
  `assets/scenery/CREDITS.md`; `assets/maps/`, `assets/audio/` and `arcade-cars.json` are derived
  from a commercial game's data and are not redistributable. A public build needs its own track,
  its own audio and its own handling numbers, or the rights to those.
- Build outputs go to `build/`. No `public/` or `dist/` at the root.

## Doing the work

- Measure, do not guess. A coordinate, a colour or a height that was not read off the world or a
  probe is a guess, and scenery has already been planted in the wrong place that way.
  `npm run verify:place` reports the mesh, world point, surface normal and ground height per pixel.
- Change one thing, shoot it, look at it. Every visual claim needs a frame; "should look better" is
  not a result.
- Prefer the cheap check. `npm test` is under a second, a model shot ~3 s, a full-map screenshot
  15–60 s. Reach up the ladder only when the question demands it.
- Browser automation always runs headless and muted. Keep `--mute-audio` in every verify script.
- Before saying it works: `npx tsc --noEmit`, `npm test`, and a shot for anything visual. If a step
  was skipped, say which.

## Commands

```
npm run dev                  dev server (127.0.0.1) — only on request
npm test                     unit tests, node --test
npm run build                tsc --noEmit + vite build
npm run models               normalize vehicle GLBs (Blender); ONLY=<id> bakes one
ONLY=<id> PREVIEW=1 npm run models   draw that car's wheel marks instead of baking
npm run models:simplify      triangle budgets      npm run models:compress   meshopt + WebP
node scripts/build-scenery.mjs <id> [--keep N] [--rotate x,y,z] [--tint r,g,b] [--drop a,b]
node scripts/build-scenery-catalog.mjs            refresh assets/scenery/catalog.json
node scripts/extract-track.mjs --track TR04 --id last-resort --out assets/maps/last-resort-track.glb
```

Verify tools (headless, no server; run `npm run build && npm run verify:file-dist` first):

```
npm run verify:model -- marlin-f1            four views + measured summary of one model
npm run verify:place -- ...                  labelled pixel grid: what is at each pixel, and where
npm run verify:freecam -- out.png --map last-resort --from x,y,z --at x,y,z
npm run verify:looks -- --map ... --from ... --at ...     every shading style (--kind look: grades)
npm run verify:post  -- --map ... --from ... --at ...     the same frame with the post stack off/on
npm run verify:shot                          full-map chase-camera screenshot (slow)
```

`/model.html?vehicle=<id>` (or `?model=/scenery/palm.glb`, `&node=`, `&spin=`, `&view=rear`,
`&lamps=on|hide`) is the same viewer in a browser; the measurements sit on `window.__model`, and
`window.__probe(px, py)` turns a screenshot pixel into a world point.

`?tune` on the running app opens sliders for the shading style, grade filter, outline, toon ramp and
every post knob. "değerleri kopyala" puts the chosen set on the clipboard — that is how a look gets
into the defaults, instead of being guessed in a commit.

## Tests

They cover behaviour, not appearance: driving, collision, flight, AI pacing, the chase camera,
headlight hysteresis, the wall corridor, terrain, and that the menu plan view agrees with the physics
world. `tests/models.test.mjs` is the one asset guard — every `vehicles.json` GLB is checked for
centring, ground contact, four `WHL[0-3]_H` nodes, wheelbase and track width.

Add a test when the thing can be stated as a rule and read by a machine. Anything judged by eye
belongs in a verify shot. Do not pin the geometry or colour of a baked asset in a test; it breaks on
every re-bake and proves nothing.
