# Limitations — what ONE DEGREE does and does not claim

**Geometry, not engineering.** "Sunlit" means at least half of the Sun's disc is above
the terrain skyline. It is not a power model: no panel orientation, efficiency, dust or
battery is simulated. "Earth in view" means Earth's centre is above the skyline: line
of sight is necessary for direct-to-Earth radio, not sufficient (no antenna pattern,
link budget, interference or relay satellites are modelled). Nothing here certifies a
landing site as safe.

**Terrain resolution.** Skylines use NASA LOLA DEMs at 10 m (south of 83°S), 20 m,
80 m and 240 m; effective resolution varies with track density (PGDA product 90 ships
LDEM_EFFRES). Points south of 80°S without a precomputed profile use a 400 m grid in
the browser (craters smaller than ~1 km are not resolved) and are labelled so. North of
80°S, a landing point without a profile has no terrain model: the horizon is the smooth
sphere's and is labelled "geometric only".

**The 3D world.** The ground geometry is the LOLA data (no invented relief). Finer
detail — micro-craters, regolith texture, rocks — is procedural decoration, labelled
in the display settings, and never used by any calculation. Direct sunlight in the 3D
view uses the shadow map for relief within ~260 m of you and the distant horizon,
computed from your position, beyond ~350 m; terrain between those distances shades
correctly but at mesh resolution. Shadowed areas are lifted for readability by an
ambient + bounce + earthshine fill (toggle "Realistic darkness" for vacuum-black
shadows) — that fill is never reported as sunlight.

**Sky.** Sun and Earth directions are Horizons-accurate (measured). Earth's apparent
size uses the Horizons distance and its phase follows from the lighting; Earth's
spin is approximate (sidereal time only), its axis roll and cloud layer are
illustrative. The star field is decorative, not a catalogue.

**Time span.** The Horizons table covers 1 Aug 2023 – 1 Jan 2029 (hourly); the app
works only inside it. Windows use 30-minute steps.

**The outpost and missions are fiction.** The site is real and data-chosen; the base,
lander, rover, instruments and mission story are a simulation set, not a NASA plan.
Movement is lunar-gravity physics with comfort concessions (walk 3 m/s, sprint
7.5 m/s — faster than Apollo crews managed — adjustable; slight air control; staying
grounded on small downhill rises). The rover is a kinematic gameplay vehicle (8 m/s
top speed; the Apollo LRV did about 5 m/s), not an engineering model. Ascent and descent are cinematic camera moves, not flight
dynamics. There is no sound in vacuum; the app is silent.

**Orbit globe.** Uses NASA Moon Trek LRO WAC imagery (~100 m/px at best); with an
optional Cesium ion token it can stream Cesium Moon tiles (not tested by us without a
token).

## v5 (spacecraft, bases, missions, saving)
- **Explorer flight is assisted game flight.** Gravity is a point mass (no mascons, no Earth/Sun perturbations),
  the Moon's 27.3-day rotation is neglected, propellant is unlimited and the engine is strong (8 m/s²). The autopilot is a
  feedback law, not trajectory optimisation. Time warp (×2–×50) compresses time; it does not change the physics.
- **Terrain while flying:** below ~14 km the craft flies over the measured LOLA region of the nearest site; elsewhere the
  orbit view shows a smooth textured sphere (no local relief). Custom landings use the 400 m LOLA grid near the pole or a
  smooth sphere elsewhere — the HUD/landing label says which.
- **Bases are fictional** facilities on real, data-chosen sites. Their buildings are decorative; colliders are simple circles.
- **Saves are local to this browser** (localStorage). No cloud or cross-device sync. Clearing site data erases progress.
- **Rapier physics** remains on the `physics-proto` branch; v5 gameplay does not depend on it.
- **Not built:** Earth excursion; more than one rover per region; NPCs.
