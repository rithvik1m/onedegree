# Data sources

Every number in ONE DEGREE comes from one of these, or is derived from them by code
in this repository.

| Data | Provider | Exact product / query | Coverage & resolution | Used for |
|---|---|---|---|---|
| Moon sub-solar & sub-Earth points, Earth–Moon distance | NASA/JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`) | `COMMAND='301' CENTER='500@399' EPHEM_TYPE='OBSERVER' QUANTITIES='14,15,20' STEP_SIZE='1h'`, 2023-08-01 → 2029-01-01 (`scripts/fetch_horizons.py`) | hourly, 47,521 rows | Sun/Earth direction at any lunar point |
| Topocentric Sun/Earth az/el (validation only) | NASA/JPL Horizons API | `CENTER='coord@301' COORD_TYPE='GEODETIC' SITE_COORD='lon,lat,0' QUANTITIES='4'`, 5 sites × 2 windows, all at :30 (`scripts/fetch_fixtures.py`) | 200 cases | Reality Check §1, `tests/sky.test.ts` |
| South-pole DEMs | NASA Goddard PGDA product 90, Barker et al. 2023 — <https://pgda.gsfc.nasa.gov/products/90> | `LDEM_80S_20MPP_ADJ.TIF` (windows via HTTP range reads), `LDEM_80S_80MPP_ADJ.TIF`, `LDEM_60S_240MPP_ADJ.TIF`; polar stereographic, 1737.4 km sphere, MOON_ME (DE421) | 20 / 80 / 240 m | skylines, 400 m browser grid, 3D relief, relief texture |
| Polar illumination & Earth visibility maps (validation only) | NASA Goddard PGDA product 69, Mazarico et al. — <https://pgda.gsfc.nasa.gov/products/69> | `AVGVISIB_75S_120M_201608.TIF`, `…_EARTH.TIF`; DN × 0.00004 per PDS label | 18.6-yr hourly average, 120 m | Reality Check §5 |
| Global imagery | NASA Moon Trek — LRO WAC global mosaic (`LRO_WAC_Mosaic_Global_303ppd_v02`, WMTS) — <https://trek.nasa.gov/moon/> | levels 0–8 | ~100 m/px at the equator | 3D globe |
| Cesium Moon Terrain (optional) | Cesium ion asset 2684829 — <https://cesium.com/platform/cesium-ion/content/cesium-moon/> | only with a user-supplied token | — | 3D surface |
| Astronaut model | NASA 3D Resources — <https://github.com/nasa/NASA-3D-Resources> ("free and without copyright") | `3D Models/Astronaut/Astronaut.glb` | — | first/third-person body |

## Site coordinates

| Site | Coordinates | Source |
|---|---|---|
| IM-2 Athena target | 84.78°S, 29.13°E | LROC "IM-2 Landing Region" (<https://www.lroc.asu.edu/images/1401>); Athena landed ~250 m away |
| IM-1 Odysseus | 80.13°S, 1.44°E | location verified by NASA's LROC team, as reported (SpaceNews, Benzinga, Feb 2024); LROC elevation 2,579 m |
| Chandrayaan-3 Vikram | 69.373°S, 32.319°E | IAU-approved Statio Shiv Shakti (WGPSN, Mar 2024) |
| Apollo 11 | 0.67408°N, 23.47297°E | LROC / NASA |
| Artemis candidate regions | names only | NASA, Oct 2024 — broad regions, not points: <https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/> |

## Mission context cited in the app

- Chandrayaan-3: ISRO put Vikram to sleep at 02:30 UTC on 4 Sep 2023, "a little before sunset" (Gizmodo, Outlook India, Sep 2023).
- IM-1 Odysseus: operated until about 29 Feb 2024 as lunar night approached (Satnews / Intuitive Machines, Feb 2024).
- IM-2 Athena: landed on its side in a crater on 6 Mar 2025; mission ended the next day (Spaceflight Now, Astronomy, Mar 2025).
