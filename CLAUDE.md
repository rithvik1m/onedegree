# ONE DEGREE — working notes for Claude Code

ONE DEGREE (team Beyond Million) is a NASA Space Apps 2026 entry for the
**Lunar Landing Site Navigator** challenge. Thesis: *"On the Moon, one degree
decides everything."* Near the lunar south pole the Sun never rises more than a
few degrees, so a ridge one degree high is the difference between power and night.

The app is two layers on one state:
1. **Explore** — a 3D Moon (CesiumJS): orbit view, land anywhere, walk in first person
   (astronaut body visible when you look down).
2. **Mission science** — real NASA/JPL Horizons Sun/Earth geometry tested against a
   real LRO/LOLA terrain skyline: panorama, 30-day timeline, A/B compare, date-slip
   slider, Reality Check.

## Non-negotiables
- Never fabricate a number. Every metric is computed from a named NASA source or is
  conspicuously labelled (geometric-only, illustrative, not validated).
- "Earth visible" = geometric line of sight, never "radio link works".
  "Sun visible" = disc above the terrain skyline, never "power guaranteed".
- Reality Check shows measured errors from tests that actually ran; never fixed "pass" text.
- Credit everything (docs/DATA_SOURCES.md, docs/THIRD_PARTY_ATTRIBUTION.md); disclose AI
  use honestly (docs/AI_DISCLOSURE.md); Apache-2.0; no NASA logos in generated art;
  no likeness/voice of minors in the demo.
- No credentials in git. The Cesium ion token comes from `VITE_CESIUM_ION_TOKEN`
  (.env.local / Vercel env) or the in-app token field (kept in localStorage).

## Layout
- `scripts/` Python data prep (venv: `.venv-data`, `numpy rasterio pyproj scipy requests`).
  Raw NASA rasters live in `data_raw/` (git-ignored; 7 GB disk free — never fetch multi-GB files).
- `public/data/` the small derived products the app ships (ephemeris table, horizon
  profiles, validation fixtures, sites).
- `src/science/` pure maths (no DOM) — unit-tested in `tests/`.
- `src/` UI and Cesium layers.

## Commands
- `npm run dev` — local app · `npm test` — science tests · `npm run build` — typecheck + bundle.
- Data: `.venv-data/bin/python scripts/fetch_horizons.py`, `scripts/fetch_fixtures.py`,
  `scripts/compute_horizons.py`.

## Workflow
Commit and push to github.com/rithvik1m/onedegree after every working step or fix
(standing instruction from the owner). Update docs/STATUS.md at each milestone.
Deadline: Sun Nov 15 2026, 23:59 PT — submit by ~23:00.
