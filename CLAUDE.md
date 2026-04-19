# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:5173
npm run build    # Production build
npm run lint     # ESLint check
npm run preview  # Preview production build locally
```

There are no tests.

## Architecture

The entire application lives in a single monolithic file: [src/App.jsx](src/App.jsx) (~3100 lines). This is intentional — it's a game prototype optimised for fast iteration, not modularity.

### File layout within App.jsx

| Lines | Purpose |
|-------|---------|
| 0–193 | Constants: physics, wind, UI dimensions, damage states, generation parameters |
| 195–1114 | Pure utility functions: RNG, math helpers, wind calculations, procedural generation |
| 1120–2400 | React component (`App`): all state, event listeners, game loop, JSX |
| 2400–3117 | Physics, collision, and canvas drawing functions |

### State strategy

The app uses a deliberate hybrid:
- **`useRef`** for values that change every frame (`boatRef`, `windRef`, `pressedKeys`, wave state) — avoids triggering re-renders in the game loop.
- **`useState`** for UI state (menus, settings, seed input) — drives React re-renders.
- **`useMemo`** for expensive world generation — rebuilds islands/waves only when `seed` changes.

### Game loop

`requestAnimationFrame` drives the loop. Each frame:
1. Compute `dt` (capped at 50 ms to avoid spiral-of-death on tab blur).
2. `updateBoat(dt, wind)` — sailing physics, collision detection, damage.
3. `updateWindState(...)` — gradual wind shifts.
4. `updateWaves(...)` — wave animation.
5. `drawScene(ctx, ...)` → `drawMiniMap` / `drawWorldMap` if visible.

### Sailing physics

Speed is determined by the angle between the boat's heading and the wind direction, using a lookup table of wind angle multipliers (headwind = 0×, beam reach = 1.05×, running = 1.35×). There is a ±20° no-go zone directly into the wind. The damage system (7 states) caps max speed proportionally.

### Procedural generation

All world content is derived from a 16-character string seed using **Cyrb128 + SFC32** PRNG. The seed is reproducible — sharing it recreates the same world exactly. Wind uses a separate seed (`${seed}-wind`). Generation happens inside `useMemo` so it only runs on seed change.

### Rendering

Pure Canvas 2D — no WebGL. Main canvas renders sea, islands, boat, and wind indicators. A separate 200 px circular mini-map and a full-screen world map (orthographic globe projection with pan/zoom) are drawn on demand.

### Collision

Boat hull is approximated by 21 sample points (hull vertices + edge midpoints). Per-frame point-in-polygon ray casting checks each sample against coastline polygons. On penetration, the boat is pushed back and takes damage.
