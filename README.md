# Open Speed

A browser arcade racer built with Three.js and TypeScript: a fixed 64 Hz driving model,
AI opponents, and two circuits — the banked Proving Grounds oval and the coastal Last Resort.

```
npm ci        install
npm run dev   dev server on 127.0.0.1
npm test      unit tests
npm run build type check + production build
```

Working on the code? Read `AGENTS.md` — layout, rules and the verify tools.

## Licence and credits

The code is MIT (`LICENSE`). The assets are not all mine to license:

- `assets/vehicles/` and `assets/sky/` are generated, and baked by `scripts/normalize-models.py`
  from sources kept outside the tree (`$OPEN_SPEED_SOURCE`).
- `assets/scenery/` is CC0 and CC-BY. Every CC-BY model and its author are listed in
  `assets/scenery/CREDITS.md`; keep that file with any copy of these assets.
- `assets/maps/`, `assets/audio/` and `src/data/arcade-cars.json` are derived from a commercial
  game's own data files and are **not redistributable**. They are in this tree for development;
  see `AGENTS.md` before publishing a build.
