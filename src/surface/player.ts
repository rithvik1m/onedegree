// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * On-foot movement under lunar gravity.
 *
 * PHYSICS (real): g = 1.62 m/s²; a jump launched at 2.2 m/s rises ~1.5 m and
 * stays up ~2.7 s; momentum carries in the air (little air control: there is no
 * air to push against, so steering mid-jump is a game concession kept small).
 * Ground traction is lower than on Earth (weight is 1/6), so you accelerate and
 * stop more slowly. Slopes steeper than ~30° cannot be climbed.
 *
 * GAME CONCESSIONS (labelled in the controls help): walking 3 m/s and Shift sprinting
 * at 7.5 m/s — faster than Apollo crews managed (~2 m/s) — so exploring is never a
 * chore; `speedScale` (display settings) adjusts both.
 */

import * as THREE from "three";

export const G_MOON = 1.62;
export const EYE_HEIGHT = 1.62;
const WALK = 3.0;
const LOPE = 7.5;
const JUMP_V = 2.4;

export interface Collider { x: number; z: number; r: number }

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0; // radians, 0 = facing north (−z), increasing clockwise (toward east)
  pitch = 0;
  onGround = true;
  thirdPerson = false;
  keys = new Set<string>();
  colliders: Collider[] = [];
  enabled = true;
  /** distance walked (for footstep cues) */
  stride = 0;
  landedAt = 0;
  /** comfort multiplier for walk/sprint speed (game assist) */
  speedScale = 1;

  constructor(private ground: (x: number, z: number) => number) {}

  setGround(f: (x: number, z: number) => number): void {
    this.ground = f;
  }

  place(x: number, z: number, yawRad: number): void {
    this.pos.set(x, this.ground(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yawRad;
    this.pitch = -0.05;
    this.onGround = true;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get running(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  jump(): void {
    if (!this.onGround || !this.enabled) return;
    this.vel.y = JUMP_V;
    this.onGround = false;
  }

  update(dt: number, now: number): void {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has("KeyW") || k.has("ArrowUp")) fz += 1;
      if (k.has("KeyS") || k.has("ArrowDown")) fz -= 1;
      if (k.has("KeyD") || k.has("ArrowRight")) fx += 1;
      if (k.has("KeyA") || k.has("ArrowLeft")) fx -= 1;
      if (k.has("KeyQ")) this.yaw -= dt * 1.6;
      if (k.has("KeyE") && false) this.yaw += dt * 1.6;
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (sin yaw, 0, −cos yaw); right = (cos yaw, 0, sin yaw)
    const want = (this.running ? LOPE : WALK) * this.speedScale;
    let tx = (sy * fz + cy * fx) * want * (fx || fz ? 1 : 0);
    let tz = (-cy * fz + sy * fx) * want * (fx || fz ? 1 : 0);

    // slope check: don't climb steeper than ~30°
    if (tx || tz) {
      const h0 = this.ground(this.pos.x, this.pos.z);
      const s = 0.6;
      const h1 = this.ground(this.pos.x + (tx / want) * s, this.pos.z + (tz / want) * s);
      const grade = (h1 - h0) / s;
      if (grade > 0.58) { tx = 0; tz = 0; } else if (grade > 0.3) { tx *= 0.5; tz *= 0.5; }
    }
    // already moving into a wall steeper than ~30°: stop, like walking into a bank of rock
    const mv = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && mv > 0.05) {
      const h0 = this.ground(this.pos.x, this.pos.z);
      const s = 0.5;
      const h1 = this.ground(this.pos.x + (this.vel.x / mv) * s, this.pos.z + (this.vel.z / mv) * s);
      if ((h1 - h0) / s > 0.58) { this.vel.x = 0; this.vel.z = 0; }
    }

    const accel = this.onGround ? (tx || tz ? 12 : 9) : 1.2;
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const step = Math.min(dl, accel * dt);
    if (dl > 1e-6) {
      this.vel.x += (dvx / dl) * step;
      this.vel.z += (dvz / dl) * step;
    }
    this.vel.y -= G_MOON * dt;

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    this.pos.x = nx;
    this.pos.z = nz;
    // structures: push out of circles
    for (const c of this.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const rr = c.r + 0.35;
      if (d < rr && d > 1e-6) {
        this.pos.x = c.x + (dx / d) * rr;
        this.pos.z = c.z + (dz / d) * rr;
        const vn = (this.vel.x * dx + this.vel.z * dz) / d;
        if (vn < 0) { this.vel.x -= (vn * dx) / d; this.vel.z -= (vn * dz) / d; }
      }
    }
    this.pos.y += this.vel.y * dt;
    const g = this.ground(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      if (!this.onGround && this.vel.y < -1.2) this.landedAt = now;
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && this.vel.y <= 0 && this.pos.y - g < 0.35) {
      // comfort: stay on the ground walking downhill (at lope speed real
      // low gravity would let you drift off small rises)
      this.pos.y = g;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
    this.stride += this.horizontalSpeed * dt;
  }
}
