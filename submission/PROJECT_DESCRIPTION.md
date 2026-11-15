# Submission draft — ONE DEGREE (team Beyond Million)

> Draft for the owner to edit into their own words before pasting into the Space Apps
> project form. Every claim below is something the app actually does and shows.

## Project name
ONE DEGREE

## High-level summary
Near the Moon's south pole the Sun never climbs more than a few degrees, so a ridge
one degree high decides whether a lander gets power and whether it can see Earth.
ONE DEGREE lets anyone stand at a landing site in 3D, see the real terrain skyline
from NASA's LRO laser altimeter, and watch the Sun and Earth — positioned with
NASA/JPL Horizons — rise, set and slip behind ridges. A mission planner compares two
sites over a lunar day, slides the landing date to see what a schedule slip costs,
and reads sunlight, Earth line of sight, longest night and longest blackout. A live
Reality Check re-tests every number against NASA's own outputs.

## Links
- Project demo (≤30 s video): _YouTube link_
- Final project (live app): _https://….vercel.app_ · source: https://github.com/rithvik1m/onedegree

## Detailed project description
**What it does.** Explore: orbit the Moon, land anywhere, walk in first person (look
down to see the astronaut suit; V for third person). Scan (M): Sun and Earth position
now, the skyline height in that direction and how far they clear it, a 360° skyline
panorama with 30 days of Sun/Earth positions, and a sunlight/Earth/both timeline. One
toggle swaps the real terrain for a smooth Moon to show what terrain-blind tools miss.
Plan (P): two sites side by side, a ±14-day slip slider, and plain-language verdicts.

**How it works.** (1) One hourly Horizons table of the Moon's sub-solar and sub-Earth
points (Aug 2023 – Dec 2028) gives Sun/Earth azimuth/elevation for any lunar point by
vector maths. (2) Terrain skylines come from 720 great-circle rays through NASA
Goddard LOLA DEMs at 20/80/240 m, with exact lunar curvature and a 2 m eye height;
custom points south of 80°S are computed in the browser on a 400 m grid. (3) The Sun's
disc is clipped against the skyline; Earth is tested for line of sight; metrics are
computed over an explicit window.

**Why it's credible.** Measured in the app: Sun direction within 0.0002° of Horizons'
own topocentric output (200 cases, 5 sites); Earth within 0.006°. Ground height at the
Odysseus site 2,592 m vs 2,579 m reported by LROC. Long-term sunlight at the Athena
site 45.1 % vs 46.5 % in NASA Goddard's 18.6-year illumination map, Earth visibility
93.1 % vs 93.1 %. Predicted sunset at Chandrayaan-3's site falls 3.7 h after ISRO put
Vikram to sleep "a little before sunset".

**Benefits.** Planners can re-check a slipped date or a neighbouring site in seconds
instead of stitching Horizons and topography tools together; students and the public
can see — not just read — why the lunar south pole is so hard.

**Limits.** Geometry only: sunlight is not a power model; Earth in view is not a radio
link; DEM cells are 20–400 m; the 3D scene is a visualisation; ephemeris spans
Aug 2023 – Dec 2028.

**Tools.** TypeScript, Vite, CesiumJS, HTML canvas; Python (numpy, rasterio, pyproj,
scipy) for data processing; Vitest.

## Use of SI (AI)
See docs/AI_DISCLOSURE.md — AI chat tools for brainstorming and planning; Claude Code
wrote most of the code under the owner's direction; all data are NASA's; no
AI-generated images, video or audio.

## NASA data
NASA/JPL Horizons; NASA Goddard PGDA LOLA south-pole DEMs (Barker et al. 2023) and
polar illumination maps (Mazarico et al.); NASA Moon Trek LRO WAC mosaic; NASA 3D
Resources astronaut; LROC landing-site locations.

## Space Agency Partner data & other references
Canadian Space Agency Moon exploration portal (challenge resource, context); ISRO
Chandrayaan-3 mission timeline (Reality Check); IAU WGPSN Statio Shiv Shakti
coordinates; CesiumJS (Apache-2.0); Cesium Moon Terrain (optional). Earlier own work
reused: control styling from Cosmic Collision Shield (docs/REUSED_WORK.md).
