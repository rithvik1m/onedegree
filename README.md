# ONE DEGREE

**On the Moon, one degree decides everything.**

NASA Space Apps Challenge 2026 · **Lunar Landing Site Navigator** · team **Beyond Million**

Near the lunar south pole the Sun never climbs more than a few degrees above the
horizon. A ridge one degree high is the difference between a lander that charges and
one that freezes — and whether it can see Earth to call home.

ONE DEGREE is a **science-first lunar research mission you can play**. You arrive at a
(fictional) research outpost on the rim of Shackleton crater and use field instruments
to answer real mission-planning questions — *does this spot get sunlight? when can it
see Earth? why is a place 433 m away so much worse? which landing site is better, and
does a one-week slip change the answer?* Every number comes from NASA data.

## The experience

- **Opening.** A flyover of the outpost, the thesis, and your task — skippable; choose
  *Begin Mission 01* or *Free exploration*.
- **Walk the outpost.** First person (look down: legs and boots) or third person (**V**).
  WASD, mouse look (click to capture, **Esc** to release), **Shift** lope, **Space**
  low-gravity jump (g = 1.62 m/s²), **E** use, **L** helmet lamp.
- **Science is the gameplay — five missions:**
  1. **First Light** — the Solar Monitoring Station: Sun elevation/azimuth, the LOLA
     horizon in that direction, clearance, next sunset, 30-day sunlight and longest
     night. Scrub or play time and watch the Sun (and the sun-tracking solar arrays)
     move in the 3D sky; the Sun's 30-day path is drawn amber where it clears the
     terrain and red where it is blocked.
  2. **Calling Earth** — the Comms Station: the dish points at Earth's real direction;
     line of sight, next Earth-set, longest blackout (line of sight ≠ radio link).
  3. **The Shadow Problem** — lope to Survey point S-1, 433 m away and 82 m lower:
     real terrain vs smooth Moon vs the outpost. Trace the scanner's LOLA horizon over
     the 3D ridges.
  4. **Choose the Landing Site** — the Mission Control console (the planner): Athena vs
     Odysseus against a stated requirement (Sun **and** Earth together).
  5. **The Delay** — slip the launch 7 days and re-check.
- **Orbit and land anywhere.** Board the lander (or **O**): ascent, a CesiumJS globe
  with NASA LRO imagery, a landing preview computed live (Sun/Earth now, 30-day
  sunlight and Earth %), then descent onto LOLA terrain at the chosen point.
- **Field scanner (M), Planner (P), Reality Check** — kept from v1 and shared by the
  instruments: one engine, so nothing can disagree.

## What is real, what is modelled, what is fiction

| Real NASA data | Computed by this app from NASA data | Simplified physics | Fiction (labelled) |
|---|---|---|---|
| Sun/Earth directions (JPL Horizons); terrain heights (LOLA 10/20/80/240 m DEMs); long-term illumination maps (PGDA 69); Earth imagery (Blue Marble) | skylines, sunlight/Earth %, nights, blackouts, site choice for the outpost | lunar gravity, jumps, slope limit; lunar-Lambert shading; bounce/earthshine fill | the outpost, lander, rover, instruments, missions, astronaut gaits, micro-craters and rocks finer than the DEM |

The 3D terrain is built from the **same great-circle rays** the scanner uses: the
horizon of the 3D mesh matches the scanner's LOLA skyline to **0.019° mean / 0.153°
max** (`tests/surface.test.ts`). Procedural rocks and micro-craters change shading only
and are never used by any calculation.

## Measured results

| Check | Result |
|---|---|
| Sun direction vs Horizons' own topocentric ephemeris (200 cases, 5 sites, mid-hour) | max **0.0002°** |
| Earth direction vs Horizons | max **0.006°** (~20″, aberration-sized) |
| 3D-world horizon vs scanner skyline at the outpost (720 directions) | mean **0.019°**, max **0.153°** |
| Ground height at the Odysseus site | **2,592 m** vs **2,579 m** (NASA LROC) |
| Long-term sunlight / Earth visibility, Athena site | **45.1 % / 93.1 %** vs **46.5 % / 93.1 %** (NASA 18.6-yr maps) |
| Predicted sunset at Chandrayaan-3's site | 3.7 h after ISRO put Vikram to sleep "a little before sunset" |
| Outpost vs Survey S-1 (433 m apart), 30 days from 15 Nov 2026 | sunlit **100 %** vs **20 %** (smooth Moon would say 100 % at both) |
| GPU-synced frame time, outpost scene, 1440×900, this dev Mac (headless Chrome, Metal) | **~2–3 ms** |

## How the outpost site was chosen (by code, not by hand)

`scripts/outpost.py`: within 25 km of the pole, slope < 8° (LOLA 80 m), Earth up ≥ 30 %
of the time, maximise long-term sunlight in NASA Goddard's 18.6-year illumination map
(PGDA product 69). Winner: **89.687°S, 162.711°W** — sunlight 89.6 %, Earth 53.8 % —
10.8 km from the IAU centre of Shackleton crater (radius 10.5 km), i.e. on its rim.
Survey S-1 is the nearby spot (300–1500 m) with the least sunlight that is not
permanently dark.

## How it works

1. **Sun & Earth** — one hourly NASA/JPL Horizons table (Aug 2023 – Jan 2029) of the
   apparent sub-solar and sub-Earth points on the Moon; azimuth/elevation for any point
   by vector maths in the local east/north/up frame (`src/science/sky.ts`).
2. **Terrain skyline** — 720 great-circle rays through NASA Goddard LOLA DEMs
   (10 m near field south of 83°S, 20 m, 80 m to 150 km, 240 m to 260 km), exact
   elevation angles with curvature and a 2 m eye (`scripts/compute_horizons.py`,
   `scripts/outpost.py`).
3. **Walkable terrain** — a polar mesh of those same rays (720 azimuths × 613 rings,
   0–2 km at 10 m, then +1.15 % per ring to 220 km) with true lunar curvature
   (`src/surface/terrain3d.ts`). Lit by the Horizons Sun with a lunar-Lambert
   photometric function (McEwen 1991); a shadow map handles nearby relief, and the
   Sun is gated by the distant horizon computed from your position, so a ridge 30 km
   away can put you in shadow exactly when the scanner says so.
4. **Visibility & metrics** — Sun-disc clipping against the skyline, Earth line of
   sight, % sunlit / Earth / both, longest night, longest blackout, next change
   (`src/science/visibility.ts`).

Definitions shown in the app: *sunlit* = at least half the Sun's disc above the skyline;
*Earth in view* = Earth's centre above the skyline (geometric line of sight, **not** a
working radio link). Geometry only — not a power model, not a landing-safety
certification. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 22 tests: Horizons agreement, geometry, metrics, 3D-world consistency, physics
npm run build      # typecheck + production bundle
```

Optional: a Cesium ion token streams **Cesium Moon** 3D tiles in the orbit view (the
surface and the science never need it). Free account at <https://ion.cesium.com> →
*Asset Depot* → "Cesium Moon Terrain" → *Add to my assets* → *Access Tokens* → copy
*Default*. Put it in `.env.local` as `VITE_CESIUM_ION_TOKEN=…` (git-ignored) or in
Vercel → Settings → Environment Variables. Never commit it.

Rebuild the NASA-derived data (Python 3.11+, `numpy rasterio pyproj scipy requests`):

```bash
python scripts/fetch_horizons.py      # Horizons sub-point table
python scripts/fetch_fixtures.py      # independent Horizons topocentric checks
python scripts/compute_horizons.py    # LOLA skylines + 400 m browser grid
python scripts/outpost.py             # outpost siting + 10 m walkable terrain meshes
python scripts/extract_illumination.py
python scripts/polar_map.py
```

## Docs

[Data sources](docs/DATA_SOURCES.md) · [Third-party attribution](docs/THIRD_PARTY_ATTRIBUTION.md) ·
[Decisions](docs/DECISIONS.md) · [Limitations](docs/LIMITATIONS.md) ·
[Testing](docs/TESTING.md) · [Status](docs/STATUS.md) · [AI disclosure](docs/AI_DISCLOSURE.md) ·
[Reused work](docs/REUSED_WORK.md)

Built during NASA Space Apps 2026 (Nov 14–15). Licence: Apache-2.0. Use of NASA data
does not imply NASA endorsement; the outpost is fictional and not a NASA facility.
