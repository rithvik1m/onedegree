# Testing

## Automated (`npm test`, 22 tests, all passing)

| File | What it pins down |
|---|---|
| `tests/sky.test.ts` | Sun/Earth az/el from the Horizons sub-point table vs Horizons' own topocentric output (200 cases, 5 sites, 2 windows, sampled mid-hour): Sun ≤ 0.0002°, Earth ≤ 0.006°; frame conventions; interpolation across the 0/360° seam |
| `tests/terrain.test.ts` | polar stereographic projection (vs PROJ), exact elevation-angle formula, smooth-Moon dip, a synthetic 2 km wall at 30 km, Sun-disc fractions, longest runs |
| `tests/surface.test.ts` | ring layout = `scripts/outpost.py`; site at the scene origin; **location continuity** lon/lat → scene → lon/lat < 1 mm; **3D-mesh horizon vs scanner LOLA skyline** (mean 0.019°, max 0.153°, 720 directions); **lunar jump** apex v²/2g and air time 2v/g with g = 1.62; slope limit; **time sync** between the 3D sky and the instruments |

## In the browser (headless Chrome 157, Metal GPU, Playwright; production build via `vite preview`)

| Journey | Result |
|---|---|
| First load without a Cesium token | intro flyover renders; no console errors |
| First load with a Cesium token | not tested — no token available to us |
| Begin Mission 01 → walk (WASD) → jump | 1.6 m/s walk; vertical speed falls at 1.62 m/s² |
| Solar station (E) → time controls → Record | live numbers; Sun path amber/red in the 3D sky; debrief text computed |
| Comms station | dish points at Earth (157.1°, −0.8°); clearance +0.02°; LOS caveat shown |
| Survey S-1 (433 m) | S-1 20 % vs outpost 100 % vs smooth 100 %; LOLA horizon traced over the 3D ridges |
| Mission Control → choose site → slip +7 d | missions 04/05 complete with computed verdicts |
| Launch to orbit → pick Athena → preview → land | Cesium globe lazy-loads; preview shows live Sun/Earth/30-day values; lands on 10 m LOLA terrain |
| First / third person, looking down | FP shows legs and boots (torso, arms, helmet hidden so nothing clips the lens); TP shows full suit |
| Frame cost | ~2–3 ms GPU-synced per frame at 1440×900 (gl.finish timing) with terrain + far field + shadows + detail |
| Planner, Reality Check, Data & method | unchanged from v1, still render with no errors |

Headless Chrome caps animation at 30 fps, so fps numbers from it are not meaningful;
the gl.finish-synced frame time is the performance measure we report.
