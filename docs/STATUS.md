# Status

"Done" = ran in a real browser (headless Chrome 157, Metal GPU) or in `npm test`, with evidence.
v1 is tagged `v1.0`, v2 `v2.0`; v3 work happened on branch `v3` and is merged to `main` at checkpoints.

| Area | State | Evidence |
|---|---|---|
| Horizons sub-point table (Aug 2023 – Jan 2029, hourly) | Done | 47,521 gap-free rows; `tests/sky.test.ts` |
| Sky engine vs Horizons topocentric | Done | 200 cases: Sun max 0.0002°, Earth max 0.006° |
| LOLA skylines + 400 m browser grid | Done | Odysseus ground 2,592 m vs LROC 2,579 m |
| NASA illumination-map comparison | Done | Athena Sun 45.1 % vs 46.5 %, Earth 93.1 % vs 93.1 % |
| **v2** Outpost sited by code from NASA maps | Done | `scripts/outpost.py`: 89.687°S 162.711°W, sun 89.6 %, Earth 53.8 %; S-1 433 m away |
| **v2** Walkable 3D terrain (Three.js) from LOLA 10 m → 240 m | Done | mesh horizon vs skyline mean 0.019°, max 0.153° (`tests/surface.test.ts`) |
| **v2** Lighting: Horizons Sun, lunar-Lambert regolith, shadows, distant-horizon sun gate, labelled fill | Done | screenshots; "Realistic darkness" toggle |
| **v2** Earth: Blue Marble, true direction/size, phase from lighting, on-screen marker | Done | comms station 157.1°/−0.8° matches the scanner |
| **v2** Procedural astronaut (walk / lope / jump / idle), FP legs+boots, TP full body | Done | screenshots |
| **v2** Lunar physics (g = 1.62, jump apex/airtime, slope limit) | Done | `tests/surface.test.ts` |
| **v2** Outpost: hab, mission control, lab, sun-tracking vertical arrays, Earth-pointing dish, observation deck, pad + lander, rover bay, paths, S-1 beacon | Done | screenshots |
| **v2** Intro + missions 01–05 + instruments + debriefs | Done | played through in headless Chrome |
| **v2** Orbit ↔ surface loop (ascent, Cesium globe, landing preview, descent) | Done | landed on Athena 10 m terrain |
| **v2** Walk-in Mission Control interior (live screens; console opens the planner; airlock exit) | Done | enter → console → planner → exit tested in headless Chrome |
| Cesium Moon tiles (token path) | Untested | no token available |
| Phone layout + touch controls (v2) | Done | emulated iPhone 13: joystick moved 2.7 m; HUD fits 390 px |
| **v3** CC0 Quaternius models (astronaut, rover, base) | Done | `public/models/kit/LICENSE.md` |
| **v3** Animated astronaut, FP hand-held scanner, smooth TP camera, faster movement | Done | screenshots; sprint 7.5 m/s measured |
| **v3** Driveable rover (enter/exit, terrain-following, collisions, HUD) | Done | `tests/surface.test.ts` rover tests; headless drive at 29 km/h |
| **v3** Simple / Details / Advanced science levels | Done | screenshots of all three |
| **v3** Mission 01 rebuilt (station → rover → S-1 → field computer → why) | Done | played end to end in headless Chrome |
| **v3.1** Performance pass (two-pass depth, LOD, culling, presets, adaptive resolution) | Done | README performance table |
| **v3.1** Discovery loop at S-1 (predict → measure → see the ridge → compare → why → new question), field notes | Done | played end to end |
| **v4** H quick scan + central keymap + focus fix | Done | keypress tests in the production build |
| **v4** Ballistic dust, jump/air/land states, rover cockpit/recovery/suspension | Done | dust test; screenshots |
| **v4** Historic destinations Apollo 11/15/17 (NSSDC, LOLA 118 m, heritage rings, scope) | Done | landed at A11 and A17 in headless Chrome |
| **v4** Rapier physics prototype | Prototype on branch `physics-proto` (not production) | docs/PHYSICS.md, 6 tests |
| Spacecraft flight, second research base, side missions, progress save | Not built — roadmap | docs/ROADMAP.md |
| Production build | Done | `vite preview`, no console errors |
| Reality Check 7: 3D world vs LOLA skyline (live) | Done | mean 0.019°, max 0.153°, ~60 ms in browser |
| 30-s guided demo | Done for v3 (`src/demo.ts`); 30 s recording at `submission/onedegree_demo.mp4` (git-ignored) | captions only |
| Vercel deploy | Waiting for owner to import the repo | `vercel.json` |

## v5 — 2026-11-15 (branch v5 → main)
- Pilotable OD-1 spacecraft (src/flight/): Moon-centred flight dynamics, Explorer autopilot, orbit view.
- Shadow Research Station + EarthLink Communications Station (scripts/bases.py, src/game/bases.ts).
- Mission board + 5 optional activities (src/game/sidequests.ts); Moon map (src/ui/moonmap.ts);
  versioned save/load (src/game/progress.ts).
- Tests: 33 unit tests (7 new flight tests); browser journeys in docs/TESTING.md.
- v4.0 tag = previous stable submission build.

## v6 polish — 2026-11-15 (branch v6-polish)
- Lag root cause (measured, same 8 GB A18 Pro Mac, 2560×1440 external display): the outdoor scene rendered
  3.7 MP per frame; frames alternated 16.7/33.3 ms (44–51 fps, p95 33.4 ms). Adaptive resolution never engaged
  (threshold 28 ms). Fixes: per-preset pixel budget (Balanced 2.1 MP), 60 fps-targeted adaptive resolution,
  shadow map re-rendered only when the player moves ≥ 0.5 m or every 6th frame. After: 60 fps, p95 16.8 ms,
  1 % low 59.5 fps in every outdoor scenario. The system was also swapping (3.7 GB swap in use).
- Collision: oriented-box colliders fitted to every building's real geometry (32 at the outpost), sub-stepped
  sliding movement, rover chassis collision, third-person camera collision. Browser test: 44 sprint runs into
  11 buildings from four sides → 0 ended inside geometry; rover stops at walls; all interactions reachable.
- Movement: 150 ms jump buffer + 120 ms coyote time (input forgiveness; lunar gravity unchanged).
- Developer collider view: append ?debug=colliders.
- New interior: HAB-1 crew quarters (airlock entry from the habitat, bunks, lockers, galley notes, suit dock,
  viewport, life-support panel with real Sun/Earth status; resting advances the mission clock 8 h). Solid furniture.
- Interiors now: Mission Control + HAB-1. Other buildings are solid exteriors and are not advertised as enterable.
