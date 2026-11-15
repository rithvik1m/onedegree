# Status

"Done" = ran in a real browser (headless Chrome, Metal GPU) or in `npm test`, with evidence.

| Area | State | Evidence |
|---|---|---|
| Horizons sub-point table (Aug 2023 – Jan 2029, hourly) | Done | 47,521 gap-free rows; `tests/sky.test.ts` |
| Sky engine vs Horizons topocentric | Done | 200 cases: Sun max 0.0002°, Earth max 0.006° |
| LOLA skylines (4 sites) + 400 m browser grid | Done | Odysseus ground 2,592 m vs LROC 2,579 m |
| Visibility & metrics | Done | unit tests (disc fractions, runs, percentages) |
| NASA illumination-map comparison | Done | Athena Sun 45.1 % vs 46.5 %, Earth 93.1 % vs 93.1 % |
| 3D Moon (fallback: Moon Trek + LOLA relief) | Done | screenshots: orbit, surface, Sun on horizon, Earth in sky |
| 3D Moon (Cesium Moon tiles) | Waiting for owner's Cesium ion token | code path present, untested |
| First person + astronaut body + third person (V) | Done (body is a T-posed NASA model) | screenshots |
| Orbit, click-to-land, descent/ascent | Done | screenshots |
| Scanner, planner, compare, date slip | Done | screenshots |
| 2D south-pole map (relief + NASA sunlight/shadow), click to set A/B | Done | click at 89.38°S → live skyline, 0% sunlit vs 51% smooth |
| Phone layout | Done | 390 px screenshots |
| Production build | Done | `vite preview`, no console errors |
| Reality Check (live) | Done | in-app |
| 30-s guided demo | Done; 27 s recording at submission/onedegree_demo.mp4 (git-ignored) | `src/demo.ts` |
| Vercel deploy | Waiting for owner to import the repo | `vercel.json` |
| Submission copy | Draft | `submission/` |
