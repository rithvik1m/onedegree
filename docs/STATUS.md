# Status

"Done" = ran in a real browser (headless Chrome 157, Metal GPU) or in `npm test`, with evidence.
v1 is tagged `v1.0`; v2 work happened on branch `v2` and is merged to `main` at checkpoints.

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
| **v2** 3D interior of the mission-control module | Not built | the console opens the planner in a console style instead |
| Cesium Moon tiles (token path) | Untested | no token available |
| Phone layout (v2) | See screenshots in testing | — |
| Production build | Done | `vite preview`, no console errors |
| 30-s guided demo | Re-written for v2 (`src/demo.ts`); recording: `submission/onedegree_demo.mp4` (git-ignored) | — |
| Vercel deploy | Waiting for owner to import the repo | `vercel.json` |
