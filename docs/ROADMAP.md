# Roadmap (after the Space Apps submission)

Shipped in production (v4): central keymap; **H quick scan** (your own LOLA horizon,
Sun/Earth status, points of interest); rover cockpit camera (C) and recovery (R);
ballistic lunar dust; astronaut jump / airborne / landing states and bounding sprint;
**historic destinations** Apollo 11, 15, 17 (NSSDC coordinates, LOLA 118 m terrain,
labelled descent-stage reconstructions, NASA 2011 heritage keep-out rings, observation
scope, field-note records); field notes; discovery loop at S-1.

Prototype (branch `physics-proto`, not in production): Rapier physics manager, raycast
rover, character controller, Physics Lab page, 6 tests — see docs/PHYSICS.md.

## Next, in order
1. **Rapier rover behind a setting** (Explorer / Simulation), tuned in the Physics Lab;
   keep the kinematic rover as a fallback. Then the astronaut on the character controller.
2. **Second research base** using the location framework (`setSite` + per-site props):
   a *Solar Observatory* on a real high-illumination peak (pick by code from PGDA 69, as
   the outpost was) with a date-slip experiment; then a *Crater station* at the edge of a
   permanently shadowed region (PGDA PSR maps; water ice only as cited possibility).
3. **Side activities** on the same mission/state system: The Perfect Solar Spot (search
   several points; engine scores each), Lost Rover Signal (Earth line of sight),
   Photo expedition (screenshots stamped with lon/lat/date, never presented as NASA images),
   Gravity drop experiment (from the Physics Lab).
4. **Mission map & progress save** (localStorage): discovered sites, completed missions,
   notes; marker filters; fast travel to discovered places.
5. **Spacecraft**: Explorer flight (assisted, labelled arcade) in lunar orbit with
   landing assist → Orbital mode with a separate two-body integrator (μ_Moon =
   4902.8 km³/s², symplectic fixed step, tested against analytic circular/elliptic orbits)
   → a clearly labelled cinematic Earth excursion. Plume-surface dust on landing.
6. More historic sites (Apollo 12, 14, 16; Luna; Surveyor; Chang'e; Chandrayaan-3) with
   official coordinates; LROC traverse shapefiles for documented paths.
