// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * PhysicsManager — local rigid-body physics with Rapier 3D (prototype, branch physics-proto).
 *
 * FRAME: a local east-north-up tangent frame at the active site (x east, y up, z south),
 * the same frame as the surface renderer (src/surface/terrain3d.ts). Rapier never sees
 * Moon-scale coordinates; on travel the scene is rebuilt at the new site.
 *
 * GRAVITY: g = 1.62 m/s². `uniform` points along the site's local vertical — within 2 km
 * the true vertical tilts by d/R ≤ 0.066°, so this is exact enough for walking and
 * driving. `radial` (optional) turns world gravity off and applies m·g toward the Moon's
 * centre (0, −(R+h₀), 0) to each dynamic body every step, for larger areas. Mass is
 * never changed: a 100 kg body still has 100 kg of inertia; only its weight is lunar.
 *
 * TIME: fixed 1/60 s steps with an accumulator; at most `maxSubsteps` per frame (excess
 * time is dropped rather than spiralling); `alpha` is returned for render interpolation.
 *
 * TERRAIN: a heightfield sampled from the same LOLA patch the renderer draws
 * (groundY), so what you collide with is what you see. Decorative rocks are not
 * colliders; scientific skylines never read this module.
 */

import RAPIER from "@dimforge/rapier3d-compat";

export const G_MOON = 1.62;
export const MOON_R = 1_737_400;

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export interface VehicleSpec {
  /** chassis mass (kg) — model assumption, not a measured value for a real rover */
  mass: number;
  halfExtents: [number, number, number];
  wheelRadius: number;
  /** wheel connection points relative to the chassis centre (m), front pair first */
  wheels: [number, number, number][];
  suspensionRest: number;
  /** Bullet/Rapier convention: force per unit compression per unit chassis mass */
  stiffness: number;
  compression: number;
  relaxation: number;
  /** tyre-regolith friction slip: a tunable assumption, NOT a measured coefficient */
  frictionSlip: number;
  maxEngineForce: number;
  maxBrake: number;
}

/** A pressurised-rover-sized default. All values are labelled assumptions. */
export const DEFAULT_ROVER: VehicleSpec = {
  mass: 3000,
  halfExtents: [1.55, 0.6, 2.4],
  wheelRadius: 0.68,
  wheels: [[-1.8, -0.35, -1.9], [1.8, -0.35, -1.9], [-1.8, -0.35, 1.9], [1.8, -0.35, 1.9]],
  suspensionRest: 0.55,
  stiffness: 14,
  compression: 2.4,
  relaxation: 2.8,
  frictionSlip: 1.2,
  maxEngineForce: 2400,
  maxBrake: 60,
};

export class PhysicsManager {
  readonly world: RAPIER.World;
  readonly fixed = 1 / 60;
  maxSubsteps = 4;
  private acc = 0;
  /** last frame's total step time (ms) and number of substeps */
  stepMs = 0;
  substeps = 0;
  steps = 0;
  radial = false;
  private h0 = 0;

  constructor(opts: { radial?: boolean; siteGroundM?: number } = {}) {
    this.radial = !!opts.radial;
    this.h0 = opts.siteGroundM ?? 0;
    this.world = new RAPIER.World(this.radial ? { x: 0, y: 0, z: 0 } : { x: 0, y: -G_MOON, z: 0 });
    this.world.timestep = this.fixed;
  }

  /** Advance by a frame of length dt (s). Returns interpolation alpha in [0, 1). */
  step(dt: number, pre?: (h: number) => void): number {
    const t0 = performance.now();
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= this.fixed && n < this.maxSubsteps) {
      pre?.(this.fixed);
      if (this.radial) this.applyRadialGravity();
      this.world.step();
      this.acc -= this.fixed;
      n++;
      this.steps++;
    }
    if (n === this.maxSubsteps && this.acc >= this.fixed) this.acc = 0; // drop backlog, never spiral
    this.substeps = n;
    this.stepMs = performance.now() - t0;
    return this.acc / this.fixed;
  }

  private applyRadialGravity(): void {
    const cy = -(MOON_R + this.h0);
    this.world.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      const p = b.translation();
      const dx = -p.x, dy = cy - p.y, dz = -p.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const m = b.mass();
      b.resetForces(true);
      b.addForce({ x: (dx / l) * m * G_MOON, y: (dy / l) * m * G_MOON, z: (dz / l) * m * G_MOON }, true);
    });
  }

  /**
   * Static terrain: a heightfield of `n`×`n` cells of `cell` metres centred on (cx, cz),
   * heights from `ground` (the renderer's LOLA surface).
   */
  addTerrain(ground: (x: number, z: number) => number, cx: number, cz: number, n = 120, cell = 2): RAPIER.Collider {
    const size = n * cell;
    const heights = new Float32Array((n + 1) * (n + 1));
    // Rapier: (nrows+1)×(ncols+1) matrix, column-major; rows run along local z, columns along x
    // (verified by tests/physics.test.ts: a slope along x must stop the character)
    for (let c = 0; c <= n; c++) {
      for (let r = 0; r <= n; r++) {
        const z = cz - size / 2 + r * cell;
        const x = cx - size / 2 + c * cell;
        heights[c * (n + 1) + r] = ground(x, z);
      }
    }
    const desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setTranslation(cx, 0, cz).setFriction(0.9);
    return this.world.createCollider(desc);
  }

  addBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
  }

  addBall(x: number, y: number, z: number, radius: number, mass: number): RAPIER.RigidBody {
    const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setMass(mass).setRestitution(0.1).setFriction(0.8), b);
    return b;
  }

  /** Kinematic capsule astronaut (1.85 m) moved by a character controller. */
  addCharacter(x: number, y: number, z: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider; ctl: RAPIER.KinematicCharacterController } {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + 0.95, z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.32), body);
    const ctl = this.world.createCharacterController(0.02);
    ctl.enableSnapToGround(0.4);
    ctl.enableAutostep(0.35, 0.2, true);
    ctl.setMaxSlopeClimbAngle((32 * Math.PI) / 180);
    ctl.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    ctl.setApplyImpulsesToDynamicBodies(true);
    return { body, collider, ctl };
  }

  /** Dynamic chassis + raycast wheels with spring-damper suspension. */
  addVehicle(x: number, y: number, z: number, spec: VehicleSpec = DEFAULT_ROVER): { chassis: RAPIER.RigidBody; vc: RAPIER.DynamicRayCastVehicleController; spec: VehicleSpec } {
    const [hx, hy, hz] = spec.halfExtents;
    const chassis = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false).setAngularDamping(0.6).setLinearDamping(0.05));
    // centre of mass a little low (batteries, axles) for stability
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMassProperties(spec.mass, { x: 0, y: -0.35, z: 0 }, { x: spec.mass * 1.2, y: spec.mass * 1.6, z: spec.mass * 0.9 }, { w: 1, x: 0, y: 0, z: 0 }).setFriction(0.6), chassis);
    const vc = this.world.createVehicleController(chassis);
    vc.indexUpAxis = 1;
    vc.setIndexForwardAxis = 2;
    spec.wheels.forEach((w, i) => {
      vc.addWheel({ x: w[0], y: w[1], z: w[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspensionRest, spec.wheelRadius);
      vc.setWheelSuspensionStiffness(i, spec.stiffness);
      vc.setWheelSuspensionCompression(i, spec.compression);
      vc.setWheelSuspensionRelaxation(i, spec.relaxation);
      vc.setWheelMaxSuspensionTravel(i, 0.45);
      vc.setWheelFrictionSlip(i, spec.frictionSlip);
      vc.setWheelSideFrictionStiffness(i, 1.0);
    });
    return { chassis, vc, spec };
  }

  free(): void {
    this.world.free();
  }
}

/**
 * Driving assists (gameplay, labelled): speed-sensitive steering and mild yaw damping.
 * steer ∈ [−1, 1], throttle ∈ [−1, 1], brake ∈ [0, 1].
 */
export function driveVehicle(v: { chassis: RAPIER.RigidBody; vc: RAPIER.DynamicRayCastVehicleController; spec: VehicleSpec }, steer: number, throttle: number, brake: number, assist: "explorer" | "simulation"): void {
  const speed = v.vc.currentVehicleSpeed();
  const maxSteer = assist === "explorer" ? 0.55 * (1 - Math.min(0.6, Math.abs(speed) / 14)) : 0.55;
  const engine = throttle * v.spec.maxEngineForce;
  for (let i = 0; i < 4; i++) {
    if (i < 2) v.vc.setWheelSteering(i, -steer * maxSteer);
    v.vc.setWheelEngineForce(i, i >= 2 || assist === "simulation" ? engine : engine * 0.6);
    v.vc.setWheelBrake(i, brake * v.spec.maxBrake);
  }
  if (assist === "explorer") {
    // yaw-rate damping when not steering: keeps the rover tracking straight on rough ground
    const w = v.chassis.angvel();
    if (Math.abs(steer) < 0.05) v.chassis.setAngvel({ x: w.x, y: w.y * 0.97, z: w.z }, true);
  }
}
