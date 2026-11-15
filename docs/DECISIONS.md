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

## D6 — v2: the surface is a Three.js world; Cesium stays for orbit
Cesium's heightmap terrain has no vertex normals (flat shading), its walkable detail
without an ion token was a 400 m grid, and building a base, instruments, an animated
astronaut and interactions inside it would fight the engine. The surface is now a
Three.js scene built from the LOLA data; CesiumJS is loaded lazily the first time you
launch to orbit (saves ~3 MB and GPU memory on start-up).

## D7 — walkable terrain = the scanner's own rays
Instead of a square tile, the surface is a polar mesh along the same 720 great-circle
rays the skyline uses, with exact curvature. Result: the 3D horizon equals the
scientific horizon (tested: mean 0.019°, max 0.153°). Near field 10 m (LDEM_83S_10MPP,
range-read from PGDA), so craters tens of metres across are real geometry.

## D8 — lunar-Lambert shading, sun gate, labelled fill light
Regolith is not Lambertian; at a 1–2° Sun a Lambert surface turns black. We use the
lunar-Lambert function (McEwen 1991, L = 0.7). The shadow map covers ±260 m; beyond
that, the Sun is multiplied by the disc fraction above the distant horizon computed
from the player's position, so distant ridges shade you exactly when the scanner says
so. Readability fill (ambient + regolith bounce + earthshine from Earth's direction,
scaled by Earth's phase) is a labelled visual aid with a "Realistic darkness" toggle.

## D9 — original procedural assets instead of downloaded models
The outpost, lander, rover, instruments and the jointed astronaut are built in code:
no licence uncertainty, tiny downloads, and the astronaut can walk, lope (Apollo-style
bunny hop), jump and idle without a rig. The v1 NASA astronaut model had a fixed T-pose.

## D10 — the outpost site is chosen by code from NASA maps
`scripts/outpost.py` maximises long-term sunlight (PGDA 69) within 25 km of the pole,
slope < 8°, Earth ≥ 30 %. It lands on Shackleton's rim, which is where published
studies also find the best-lit ground — we did not place it there by hand.

## D11 — Earth texture from Wikimedia Commons
NASA's eoimages server was unreachable from the build machine; the same public-domain
NASA Blue Marble image ("Whole world - land and oceans", NASA Goddard / Visible Earth)
was fetched from Wikimedia Commons and resized to 2048×1024.
