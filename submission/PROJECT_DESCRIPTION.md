# Submission draft — ONE DEGREE (team Beyond Million)

> Draft for the owner to edit into their own words before pasting into the Space Apps
> project form. Every claim below is something the app actually does and shows.

## Project name
ONE DEGREE

## High-level summary
Near the Moon's south pole the Sun never climbs more than a few degrees, so a ridge one
degree high decides whether a lander gets power and whether it can see Earth. ONE DEGREE
is a science-first lunar mission you can play: you arrive at a fictional research
outpost on the rim of Shackleton crater — a real site chosen by code from NASA's
illumination maps — and walk real NASA LOLA terrain to field instruments that answer
mission-planning questions with NASA/JPL Horizons Sun and Earth positions: is there
sunlight, when is Earth in view, why is a spot 433 m away so much darker, which landing
site is better, and does a one-week slip change the answer?

## Links
- Project demo (≤30 s video): _YouTube link_
- Final project (live app): _https://….vercel.app_ · source: https://github.com/rithvik1m/onedegree

## Detailed project description
**What it does.** A short flyover sets the task; then you play five missions on foot
(first or third person, lunar gravity, low-gravity jumps). *First Light*: the Solar
Monitoring Station shows the Sun's elevation, the terrain horizon in its direction, the
clearance, the next sunset and 30-day sunlight — scrub time and the Sun, its 30-day path
(amber = sunlit, red = blocked) and the sun-tracking solar arrays move in the 3D sky.
*Calling Earth*: the comms dish points at Earth's real direction; line of sight, next
Earth-set, longest blackout. *The Shadow Problem*: lope to Survey point S-1, 433 m away —
sunlit 20 % of the next 30 days versus 100 % at the outpost, while a smooth-Moon model
predicts 100 % at both; the scanner's LOLA horizon can be traced over the 3D ridges and a
marker shows the Sun hiding 1.8° below one. *Choose the Landing Site* and *The Delay* use
the Mission Control console to compare Athena (IM-2) and Odysseus (IM-1) against a stated
requirement and re-check after a 7-day slip. Board the lander to fly to orbit (CesiumJS
globe with NASA imagery), preview any point's conditions, and land there.

**How it works.** (1) One hourly Horizons table of the Moon's sub-solar and sub-Earth
points gives Sun/Earth azimuth/elevation for any lunar point. (2) Skylines: 720
great-circle rays through NASA Goddard LOLA DEMs at 10/20/80/240 m with exact curvature.
(3) The walkable terrain is a mesh of those same rays (10 m near field), lit by the
Horizons Sun with lunar-Lambert shading and shadows; a ridge 30 km away shades you
exactly when the scanner says so. (4) Sun-disc clipping, Earth line of sight and
mission metrics over explicit windows. The outpost site is the best-lit flat ground
within 25 km of the pole in NASA's 18.6-year illumination map — it landed on
Shackleton's rim without us placing it there.

**Why it's credible.** Measured: Sun within 0.0002° and Earth within 0.006° of Horizons'
own topocentric output (200 cases); the 3D world's horizon matches the scanner's LOLA
skyline to 0.019° mean / 0.153° max; Odysseus ground height 2,592 m vs 2,579 m (LROC);
Athena long-term sunlight 45.1 % vs 46.5 % and Earth 93.1 % vs 93.1 % (NASA maps);
Chandrayaan-3's predicted sunset 3.7 h after ISRO put Vikram to sleep "a little before
sunset". 22 automated tests; a live Reality Check re-runs the comparisons.

**Benefits.** Planners can re-check a slipped date or a neighbouring site in seconds;
students and the public can see — by walking there — why the lunar south pole is so hard.

**Limits.** Geometry only: sunlight is not a power model, Earth in view is not a radio
link, nothing certifies landing safety. The outpost, missions and suit are fiction;
micro-craters and rocks finer than the DEM are decoration that never enters a calculation.

**Tools.** TypeScript, Vite, three.js, CesiumJS, canvas; Python (numpy, rasterio, pyproj,
scipy); Vitest; Playwright for browser checks.

## Use of SI (AI)
See docs/AI_DISCLOSURE.md — AI chat tools for brainstorming and planning; Claude Code wrote
most of the code under the owner's direction; all data are NASA's; no AI-generated images,
video, audio or 3D models (the outpost and astronaut are built procedurally in code).

## NASA data
NASA/JPL Horizons; NASA Goddard PGDA LOLA south-pole DEMs (Barker et al. 2023, incl. the
10 m LDEM_83S_10MPP) and polar illumination maps (Mazarico et al.); NASA Moon Trek LRO WAC
mosaic; NASA Blue Marble; LROC landing-site locations; LOLA Shackleton depth.

## Space Agency Partner data & other references
Canadian Space Agency Moon exploration portal (challenge resource, context); ISRO
Chandrayaan-3 timeline (Reality Check); IAU/USGS Gazetteer (Shackleton, Statio Shiv Shakti);
CesiumJS (Apache-2.0); three.js (MIT); Cesium Moon Terrain (optional). Earlier own work
reused: control styling from Cosmic Collision Shield (docs/REUSED_WORK.md).
