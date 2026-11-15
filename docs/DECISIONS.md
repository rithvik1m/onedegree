# Decisions

Short records of choices that differ from the build brief, or that a reviewer would
otherwise ask about.

## D1 — Vite + strict TypeScript, no React
The brief suggests React. The UI here is a handful of panels driven by one store;
plain TypeScript modules keep the bundle small and remove a framework's worth of
setup from a one-day build. Strictness (`strict`, `noUncheckedIndexedAccess`) is kept.

## D2 — CesiumJS from Cesium's CDN (1.143), not the npm package
The npm package needs its Workers/Assets copied into the build. Loading the official
release build from cesium.com in `index.html` (as the team's earlier project did) avoids
that and keeps `node_modules` small on a nearly full disk. Our code touches Cesium
through one typed wrapper (`src/cesium/`), so swapping to npm later is local.

## D3 — Sky geometry from one Horizons table (brief's option B), verified
Instead of one Horizons request per site, the app downloads one hourly table of the
apparent sub-Earth and sub-solar points on the Moon (Horizons quantities 14/15/20)
and computes azimuth/elevation for any lunar point with vector maths. The brief allows
this only once frames are verified: `tests/sky.test.ts` compares the result with
Horizons' own topocentric answers at 5 sites (pole, near-pole landers, equator, far
side) and two date windows, sampled half-way between table rows. The measured error is
what Reality Check displays.

## D4 — Terrain skyline from NASA Goddard LOLA DEMs, precomputed
Heavy ray-marching runs offline in Python (`scripts/compute_horizons.py`) on
LDEM_80S_80MPP_ADJ (Barker et al. 2023, PGDA product 90). Great-circle rays on a
1737.4 km sphere, exact elevation-angle formula with curvature and a 2 m eye height.
The app ships compact 720-direction profiles. Points without a profile are labelled
"geometric estimate only — terrain not verified here".

## D5 — Astronaut body: NASA 3D Resources "Astronaut.glb"
Free and without copyright per the NASA 3D Resources repository; credited in
docs/THIRD_PARTY_ATTRIBUTION.md. Chosen over the model-viewer astronaut, whose exact
licence could not be confirmed.
