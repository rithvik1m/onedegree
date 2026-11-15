# ONE DEGREE

**On the Moon, one degree decides everything.**

NASA Space Apps Challenge 2026 · **Lunar Landing Site Navigator** · team **Beyond Million**

Near the lunar south pole the Sun never climbs more than a few degrees above the
horizon. A ridge one degree high is the difference between a lander that charges
and one that freezes — and whether it can see Earth to call home. ONE DEGREE lets
anyone stand at a landing site, see the real terrain skyline, and watch the Sun and
Earth move against it — then compare sites and dates like a mission planner.

## What it does

- **Walk the Moon.** A 3D Moon you can orbit, land on anywhere, and explore in first
  person (look down to see your suit; **V** for third person). The Sun and Earth in the
  3D sky sit at their true NASA/JPL Horizons positions for the chosen instant.
- **Scan a site (M).** Sun and Earth azimuth/elevation now, the skyline height in that
  direction, how far the Sun clears it, the ridge distance, a 360° skyline panorama
  with every Sun/Earth position over 30 days, and a sunlight / Earth / both timeline.
- **Real terrain vs smooth Moon.** One toggle shows what a terrain-blind tool would
  say. Orange hollow marks = "visible on a smooth Moon, hidden by real terrain".
- **Plan (P).** Compare two sites over the same window, slide the landing date ±14
  days, and read how sunlight, Earth line of sight, overlap, the longest night and
  the longest Earth blackout change.
- **Reality Check.** Every claim is re-tested live in the browser against NASA's own
  numbers, with the measured errors shown.

## Measured results (from Reality Check)

| Check | Result |
|---|---|
| Sun direction vs Horizons' own topocentric ephemeris (200 cases, 5 sites, worst-case mid-hour) | max **0.0002°** |
| Earth direction vs Horizons | max **0.006°** (~20″, aberration-sized; 1/300 of Earth's width) |
| Ground height at the Odysseus site | **2,592 m** vs **2,579 m** reported by NASA's LROC team |
| Long-term sunlight, Athena (IM-2) site | **45.1 %** vs **46.5 %** in NASA's 18.6-year LOLA illumination map |
| Long-term Earth visibility, Athena site | **93.1 %** vs **93.1 %** (NASA map) |
| Predicted sunset at Chandrayaan-3's site | 2023-09-04 06:10 UTC — ISRO put Vikram to sleep 3.7 h earlier, "a little before sunset" |
| Synthetic terrain (flat Moon dip, wall at known distance, Sun-disc half) | pass |

## How it works

1. **Sun & Earth** — one hourly NASA/JPL Horizons table (Aug 2023 – Jan 2029) of the
   apparent sub-solar and sub-Earth points on the Moon. Azimuth/elevation for any
   lunar point by vector maths in the local east/north/up frame (`src/science/sky.ts`).
2. **Terrain skyline** — 720 great-circle rays per site through NASA Goddard LOLA
   DEMs (20 m near field, 80 m to 150 km, 240 m to 260 km), exact elevation angles
   with lunar curvature and a 2 m eye height (`scripts/compute_horizons.py`). Custom
   points south of 80°S use a 400 m grid in the browser (`src/science/terrain.ts`).
3. **Visibility & metrics** — Sun-disc clipping against the skyline, Earth line of
   sight, then % sunlit / Earth / both, longest night, longest blackout and next
   sunset/Earthset over an explicit window (`src/science/visibility.ts`).

Definitions are shown in the app: *sunlit* = at least half the Sun's disc above the
skyline; *Earth in view* = Earth's centre above the skyline (geometric line of sight,
**not** a working radio link). Geometry only — not a power model, not a landing-safety
certification.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # science tests (Horizons agreement, geometry, metrics)
npm run build      # typecheck + production bundle
```

Optional: `VITE_CESIUM_ION_TOKEN` (free Cesium ion account) switches the 3D view to
Cesium Moon 3D Tiles. Without it the app uses NASA Moon Trek LRO imagery with LOLA
relief near the south pole; the science is identical either way.

Rebuild the NASA-derived data (Python 3.11+, `numpy rasterio pyproj scipy requests`):

```bash
python scripts/fetch_horizons.py      # Horizons sub-point table
python scripts/fetch_fixtures.py      # independent Horizons topocentric checks
python scripts/compute_horizons.py    # LOLA skylines + 400 m browser grid
python scripts/extract_illumination.py
python scripts/polar_texture.py
```

## Data & credits

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and
[docs/THIRD_PARTY_ATTRIBUTION.md](docs/THIRD_PARTY_ATTRIBUTION.md). Core data: NASA/JPL
Horizons; NASA Goddard PGDA LOLA DEMs (Barker et al. 2023) and polar illumination maps
(Mazarico et al.); NASA Moon Trek LRO WAC mosaic; NASA 3D Resources astronaut.

## Built during the hackathon; AI use

Built during NASA Space Apps 2026 (Nov 14–15). Small pieces of UI styling were adapted
from the team's earlier project, Cosmic Collision Shield — see
[docs/REUSED_WORK.md](docs/REUSED_WORK.md). AI assistance is disclosed in
[docs/AI_DISCLOSURE.md](docs/AI_DISCLOSURE.md).

Licence: Apache-2.0.
