# Physics engine evaluation and prototype (branch `physics-proto`, not in production)

## Choice: Rapier 3D (`@dimforge/rapier3d-compat` 0.21.0, Apache-2.0)

| Candidate | Browser build | Character controller | Vehicle | Maintenance | Verdict |
|---|---|---|---|---|---|
| **Rapier 3D** | WASM, `-compat` build embeds the binary (works in Vite and Node tests) | `KinematicCharacterController` (slopes, autostep, snap-to-ground) | `DynamicRayCastVehicleController` (raycast wheels, spring-damper suspension, friction slip) | active (0.21.0, Sep 2026) | **chosen** |
| Jolt (jolt-physics WASM) | yes | `CharacterVirtual` | wheeled vehicle constraint (more realistic tyres) | active | strong alternative; larger binary, more complex API — revisit for "Simulation" handling |
| cannon-es | pure JS | none built in | `RaycastVehicle` | slow-moving | no character controller; slower |
| Current in-house code | — | kinematic player with slope limit | kinematic bicycle model on 4 contact points | ours | stays in production until the prototype is proven |

## Architecture

```
            ┌──────────── ASTRONOMY (src/science/sky.ts) ── Horizons Sun/Earth ─┐
            │                                                                   │
TERRAIN SCIENCE (src/science/terrain.ts, public/data/horizons) ── LOLA skylines ┼─► analyse() ─► instruments, planner, missions
            │                                                                   │
            ▼                                                                   │
LOCAL SURFACE FRAME (src/surface/terrain3d.ts: lon/lat ⇄ site ENU, exact curvature)│
   │                    │                                                       │
   ▼                    ▼                                                       │
RENDERING (three.js)  LOCAL PHYSICS (src/physics/manager.ts, Rapier)            │
 terrain LOD, models   heightfield from the SAME groundY(), character,          │
 dust (src/surface/    raycast-vehicle rover, test bodies; fixed 1/60 s         │
 dust.ts, ballistic)   step + accumulator; uniform or radial lunar gravity      │
   ▲                                                                            │
   └── GAMEPLAY (src/game: missions, keymap) ◄──────────────────────────────────┘
ORBIT (src/cesium, CesiumJS globe; Ellipsoid.MOON) — no rigid-body physics; a future
orbital-dynamics module would live beside it, not inside Rapier.
```

Rules: physics never feeds the science; the science never reads render or physics
detail; decorative rocks are not colliders.

## Cesium compatibility

Cesium uses Moon-fixed coordinates (~1.7×10⁶ m) — unsuitable for a rigid-body solver.
Rapier runs only in the site's local ENU tangent frame (`terrain3d.ts`: great-circle
distance/azimuth from the site, exact curvature, `Ellipsoid.MOON` sphere 1737.4 km for
Cesium). Travelling = authoritative lon/lat is kept → new site patch loads → the physics
world is rebuilt around it → the old world is freed (`PhysicsManager.free()`).

## Measured (tests/physics.test.ts, Node; lab in headless Chrome, production build)

| Check | Result |
|---|---|
| 10 m drop, 1 kg vs 100 kg | 3.517 s and 3.517 s; theory √(2h/g) = 3.514 s |
| Frame-rate independence (30 vs 144 fps frames) | 3.533 s vs 3.521 s (within one 30 fps frame) |
| Radial vs uniform gravity, local drop | equal within one step |
| Rover at rest | 4/4 wheels in contact; suspension 0.523 m of 0.55 m rest → 0.027 m compression; theory g/(4k) = 0.029 m |
| Rover drive (explorer assist) | 12.3 m in 4 s from rest, 5.9 m/s |
| Character on 20° / 45° slope | climbs (9.1 m) / blocked (1.9 m) |
| Terrain collider vs rendered surface | balls rest at ground(x,z) + r within 0.000 m |
| Physics step cost (lab: rover + 2 balls + 240×240 m heightfield) | 0.18 ms per frame |

Assumptions (labelled in code): rover mass 3000 kg, friction slip 1.2, suspension
stiffness 14 (per unit mass), damping 2.4/2.8. These are tunable game values, not measured
regolith coefficients.

## Dust (in production)

`src/surface/dust.ts`: grains get a launch velocity from boots, landings or wheels
(only while rolling on the ground) and then follow x = x₀ + v·t, y = y₀ + v_y·t − ½g·t²
with g = 1.62 m/s², no drag, no wind; each grain is removed when it falls back to the
surface (t = 2v_y/g). One pooled draw call; 600 grains on Balanced, 1500 on High, off on
Low. Electrostatic levitation is not modelled. Test: a 2 m/s grain lands after 2.47 s.

## Next steps

1. Swap the production rover for the Rapier vehicle behind a setting (Explorer/Simulation),
   keeping the kinematic rover as fallback; tune with the lab.
2. Move the astronaut to the character controller (same animation states).
3. Spacecraft: a separate two-body orbital module (fixed-step symplectic integrator,
   Moon μ = 4902.8 km³/s²), Explorer and Orbital modes, landing burns with plume-dust —
   only after the above is stable.
