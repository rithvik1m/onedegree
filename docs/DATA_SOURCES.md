# Data sources

Every number in ONE DEGREE comes from one of these, or is derived from them by code
in this repository.

| Data | Provider | Exact product / query | Coverage & resolution | Used for |
|---|---|---|---|---|
| Moon sub-solar & sub-Earth points, Earth–Moon distance | NASA/JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`) | `COMMAND='301' CENTER='500@399' EPHEM_TYPE='OBSERVER' QUANTITIES='14,15,20' STEP_SIZE='1h'`, 2023-08-01 → 2029-01-01 (`scripts/fetch_horizons.py`) | hourly, 47,521 rows | Sun/Earth direction at any lunar point |
| Topocentric Sun/Earth az/el (validation only) | NASA/JPL Horizons API | `CENTER='coord@301' COORD_TYPE='GEODETIC' SITE_COORD='lon,lat,0' QUANTITIES='4'`, 5 sites × 2 windows, all at :30 (`scripts/fetch_fixtures.py`) | 200 cases | Reality Check §1, `tests/sky.test.ts` |
| South-pole DEMs | NASA Goddard PGDA product 90, Barker et al. 2023 — <https://pgda.gsfc.nasa.gov/products/90> | `LDEM_80S_20MPP_ADJ.TIF` (windows via HTTP range reads), `LDEM_80S_80MPP_ADJ.TIF`, `LDEM_60S_240MPP_ADJ.TIF`; polar stereographic, 1737.4 km sphere, MOON_ME (DE421) | 20 / 80 / 240 m | skylines, 400 m browser grid, 3D relief, relief texture |
| Polar illumination & Earth visibility maps (validation + planner map layer) | NASA Goddard PGDA product 69, Mazarico et al. — <https://pgda.gsfc.nasa.gov/products/69> | `AVGVISIB_75S_120M_201608.TIF`, `…_EARTH.TIF`; DN × 0.00004 per PDS label | 18.6-yr hourly average, 120 m | Reality Check §5; planner's south-pole map (`scripts/polar_map.py`) |
| Global imagery | NASA Moon Trek — LRO WAC global mosaic (`LRO_WAC_Mosaic_Global_303ppd_v02`, WMTS) — <https://trek.nasa.gov/moon/> | levels 0–8 | ~100 m/px at the equator | 3D globe |
| Cesium Moon Terrain (optional) | Cesium ion asset 2684829 — <https://cesium.com/platform/cesium-ion/content/cesium-moon/> | only with a user-supplied token | — | orbit globe |
| South-pole DEM, 10 m (v2 walkable terrain + outpost skylines) | NASA Goddard PGDA product 90 — <https://pgda.gsfc.nasa.gov/products/90> | `LDEM_83S_10MPP_ADJ.TIF` (83–90°S), 6 × 6 km windows via HTTP range reads (`scripts/outpost.py`) | 10 m | walkable terrain near the outpost and Athena; Outpost / S-1 skylines |
| Outpost siting | NASA Goddard PGDA product 69 (Mazarico et al.) | `AVGVISIB_75S_120M_201608` (Sun) and `…_EARTH` (Earth), DN × 0.00004 | 120 m | `scripts/outpost.py` picks the outpost and Survey S-1 |
| Shackleton crater centre / size | USGS Gazetteer of Planetary Nomenclature (IAU) — <https://planetarynames.wr.usgs.gov/Feature/5450> | 89.67°S, 129.78°E, diameter 20.92 km | — | "on the rim" statement (outpost is 10.8 km from the centre); NASA LOLA rim-to-floor depth 4.1 km (<https://moon.nasa.gov/resources/162>) |
| Earth imagery | NASA Blue Marble ("Whole world - land and oceans", NASA Goddard / Visible Earth), public domain, via Wikimedia Commons — <https://commons.wikimedia.org/wiki/File:Whole_world_-_land_and_oceans_12000.jpg> | resized to 2048×1024 | — | Earth in the lunar sky (`public/textures/earth_bluemarble_2048.jpg`) |
| Astronaut model (v1 only, now unused) | NASA 3D Resources — <https://github.com/nasa/NASA-3D-Resources> ("free and without copyright") | `3D Models/Astronaut/Astronaut.glb` | — | v1 Cesium walker; v2 uses an original procedural suit |

## Site coordinates

| Site | Coordinates | Source |
|---|---|---|
| IM-2 Athena target | 84.78°S, 29.13°E | LROC "IM-2 Landing Region" (<https://www.lroc.asu.edu/images/1401>); Athena landed ~250 m away |
| Outpost (fictional base, real site) | 89.68708°S, 162.71081°W | chosen by `scripts/outpost.py` from PGDA 69 maps |
| Survey point S-1 | 89.67337°S, 162.00409°W | chosen by `scripts/outpost.py` (433 m from the outpost) |
| IM-1 Odysseus | 80.13°S, 1.44°E | location verified by NASA's LROC team, as reported (SpaceNews, Benzinga, Feb 2024); LROC elevation 2,579 m |
| Chandrayaan-3 Vikram | 69.373°S, 32.319°E | IAU-approved Statio Shiv Shakti (WGPSN, Mar 2024) |
| Apollo 11 | 0.67408°N, 23.47297°E | LROC / NASA |
| Artemis candidate regions | names only | NASA, Oct 2024 — broad regions, not points: <https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/> |

## Mission context cited in the app

- Chandrayaan-3: ISRO put Vikram to sleep at 02:30 UTC on 4 Sep 2023, "a little before sunset" (Gizmodo, Outlook India, Sep 2023).
- IM-1 Odysseus: operated until about 29 Feb 2024 as lunar night approached (Satnews / Intuitive Machines, Feb 2024).
- IM-2 Athena: landed on its side in a crater on 6 Mar 2025; mission ended the next day (Spaceflight Now, Astronomy, Mar 2025).

## v4 additions

| Data | Provider | Product | Used for |
|---|---|---|---|
| Apollo Lunar Module positions | NASA NSSDC — <https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html> | A11 0.67416°N 23.47314°E · A15 26.13239°N 3.63330°E · A17 20.1911°N 30.7723°E | historic destinations |
| Apollo mission facts | NASA NSSDC — <https://nssdc.gsfc.nasa.gov/planetary/lunar/apolloland.html> | dates, EVA hours, traverse km, sample kg | historic site cards |
| Global terrain | LRO LOLA global DEM 118 m/px (USGS Astrogeology mosaic, `Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif`, range-read ±25 km) | `scripts/historic.py` | walkable terrain + skylines at Apollo 11/15/17 |
| Heritage distances | NASA 2011 "Recommendations to Space-Faring Entities" as reported (NBC News, Discover, NASASpaceflight, 2011–12): 75 m Apollo 11, 225 m Apollo 17 | — | keep-out rings (Apollo 15 uses 75 m as a labelled game choice) |

## v5 additions
- **Lunar globe imagery:** NASA Scientific Visualization Studio, *CGI Moon Kit* (svs.gsfc.nasa.gov/4720),
  LRO LROC WAC colour mosaic, `lroc_color_poles_4k.tif` → `public/textures/moon_lroc_{4096,2048}.jpg` (resampled, JPEG). Public domain (NASA).
- **South-polar map layer:** hillshade of NASA PGDA product 90 `LDEM_80S_80MPP_ADJ` (LOLA 80 m), averaged to 1536²,
  sun az 300° el 18° → `public/textures/south_pole_lola_1536.jpg`; extent ±304 km polar stereographic, R = 1737.4 km.
- **New station sites:** `scripts/bases.py` selects them from NASA PGDA product 69 long-term sun/Earth visibility maps
  (AVGVISIB_75S_120M) and LOLA 80 m slopes; horizons and walkable terrain built exactly as for the outpost.
- **Gravity:** GM(Moon) = 4902.800 km³/s² (JPL DE440); mean radius 1737.4 km.
