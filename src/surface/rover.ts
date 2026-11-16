// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Driveable pressurised rover (Quaternius "Rover", CC0). A GAMEPLAY vehicle inspired by
 * lunar exploration — not a validated engineering model.
 *
 * Kinematic bicycle model on the real LOLA terrain: four wheel contact points sample
 * the ground each frame for height, pitch and roll; slopes add or remove speed with
 * lunar gravity (a = −g·sin θ, g = 1.62 m/s²) and slopes steeper than ~28° cannot be
 * climbed; structures are solid. Top speed 8 m/s (29 km/h) is a game value — Apollo's
 * Lunar Roving Vehicle managed about 5 m/s (18 km/h).
 */

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { G_MOON, type Collider } from "./player";

const MAX_FWD = 8;
const MAX_REV = 3;
const ACCEL = 3.2;
const BRAKE = 7;
const COAST = 0.7;
const WHEELBASE = 3.8;
const MAX_STEER = 0.55;
const WHEEL_R = 0.68;
const HALF_LEN = 1.9;
const HALF_TRACK = 1.8;

interface Wheel { node: THREE.Object3D; base: THREE.Quaternion; front: boolean; spin: number }

export class Rover {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheels: Wheel[] = [];
  readonly pos = new THREE.Vector3();
  yaw = 0; // heading, clockwise from north; forward = (sin yaw, 0, −cos yaw)
  speed = 0; // m/s along heading (negative = reverse)
  steer = 0;
  private pitch = 0;
  private roll = 0;
  private lights: THREE.SpotLight[] = [];
  headlights = false;
  sign: THREE.Sprite;

  constructor(gltf: GLTF) {
    const model = gltf.scene.clone(true);
    model.position.y = WHEEL_R - 0.53; // wheel bottoms on the ground
    model.rotation.y = Math.PI; // model's cab faces +z; our forward is −z
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      if (o.name.startsWith("Wheel")) {
        this.wheels.push({ node: o, base: o.quaternion.clone(), front: o.position.z > 0, spin: 0 });
      }
    });
    this.body.add(model);
    this.root.add(this.body);
    // a sign so it is obvious you can drive it (hidden while driving)
    let tex: THREE.Texture | null = null;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 128;
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.fillStyle = "rgba(10,11,13,0.78)"; g.beginPath(); g.roundRect(4, 14, 504, 100, 18); g.fill();
      g.strokeStyle = "rgba(242,181,68,0.85)"; g.lineWidth = 4; g.stroke();
      g.fillStyle = "#f4efe6"; g.font = "700 46px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.fillText("ROVER", 256, 66);
      g.fillStyle = "rgba(244,239,230,0.75)"; g.font = "600 26px Inter, system-ui, sans-serif"; g.fillText("walk up · press E to drive", 256, 100);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.sign.scale.set(0.13, 0.0325, 1); // fixed on-screen size, never giant up close
    this.sign.position.y = 5.4;
    this.root.add(this.sign);
    for (const sx of [-0.9, 0.9]) {
      const l = new THREE.SpotLight(0xfff3e0, 0, 70, 0.5, 0.6, 1.2);
      l.position.set(sx, 1.6, -2.3);
      l.target.position.set(sx, 0.2, -14);
      this.body.add(l, l.target);
      this.lights.push(l);
    }
  }

  place(x: number, z: number, yaw: number, ground: (x: number, z: number) => number): void {
    this.pos.set(x, ground(x, z), z);
    this.yaw = yaw;
    this.speed = 0;
    this.steer = 0;
    this.settle(ground, 1);
  }

  get pitchAngle(): number {
    return this.pitch;
  }
  get rollAngle(): number {
    return this.roll;
  }

  /** Recovery (gameplay assist): stop, set upright on the terrain, nudge clear of anything solid. */
  recover(ground: (x: number, z: number) => number): void {
    this.speed = 0;
    this.steer = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pos.x += Math.sin(this.yaw) * -2;
    this.pos.z += -Math.cos(this.yaw) * -2;
    this.settle(ground, 1);
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  /** Where the driver steps out: beside the cab, on the left. */
  exitSpot(): { x: number; z: number; yaw: number } {
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return { x: this.pos.x - fz * -2.9 - fx * 0.5, z: this.pos.z + fx * -2.9 - fz * 0.5, yaw: this.yaw };
  }

  update(dt: number, keys: Set<string>, ground: (x: number, z: number) => number, colliders: Collider[], driving: boolean): void {
    const fwd = driving && (keys.has("KeyW") || keys.has("ArrowUp"));
    const back = driving && (keys.has("KeyS") || keys.has("ArrowDown"));
    const left = driving && (keys.has("KeyA") || keys.has("ArrowLeft"));
    const right = driving && (keys.has("KeyD") || keys.has("ArrowRight"));
    // steering (smoothed, less lock at speed)
    const lock = MAX_STEER * (1 - Math.min(0.55, Math.abs(this.speed) / 16));
    const want = (right ? 1 : 0) - (left ? 1 : 0);
    this.steer += (want * lock - this.steer) * Math.min(1, dt * 5);
    // throttle / brake
    if (fwd) this.speed += (this.speed < 0 ? BRAKE : ACCEL) * dt;
    else if (back) this.speed -= (this.speed > 0 ? BRAKE : ACCEL) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), COAST * dt);
    // slope: lunar gravity along the heading
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const hA = ground(this.pos.x + fx * 2, this.pos.z + fz * 2);
    const hB = ground(this.pos.x - fx * 2, this.pos.z - fz * 2);
    const grade = (hA - hB) / 4; // rise per metre ahead
    const sinT = grade / Math.sqrt(1 + grade * grade);
    this.speed -= G_MOON * sinT * dt;
    if (grade > 0.53 && this.speed > 0) this.speed = Math.min(this.speed, 0.3); // too steep to climb
    if (grade < -0.53 && this.speed < 0) this.speed = Math.max(this.speed, -0.3);
    this.speed = Math.max(-MAX_REV, Math.min(MAX_FWD, this.speed));
    // move (bicycle model)
    this.yaw += (this.speed / WHEELBASE) * Math.tan(this.steer) * dt;
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.pos.z - Math.cos(this.yaw) * this.speed * dt;
    let blocked = false;
    for (const c of colliders) {
      const d = Math.hypot(nx - c.x, nz - c.z);
      if (d < c.r + 2.3) {
        blocked = true;
        break;
      }
    }
    if (blocked) this.speed *= -0.25; // bump
    else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.settle(ground, Math.min(1, dt * 10));
    // wheels: spin by distance travelled, front pair steers
    for (const w of this.wheels) {
      w.spin += (this.speed * dt) / WHEEL_R;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.front ? -this.steer : 0);
      w.node.quaternion.copy(q).multiply(w.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), w.spin));
    }
    for (const l of this.lights) l.intensity = this.headlights ? 60 : 0;
  }

  /** Sit on the terrain: height from four contact points, pitch and roll from their differences. */
  private settle(ground: (x: number, z: number) => number, k: number): void {
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const p = this.pos;
    const hFL = ground(p.x + fx * HALF_LEN - rx * HALF_TRACK, p.z + fz * HALF_LEN - rz * HALF_TRACK);
    const hFR = ground(p.x + fx * HALF_LEN + rx * HALF_TRACK, p.z + fz * HALF_LEN + rz * HALF_TRACK);
    const hBL = ground(p.x - fx * HALF_LEN - rx * HALF_TRACK, p.z - fz * HALF_LEN - rz * HALF_TRACK);
    const hBR = ground(p.x - fx * HALF_LEN + rx * HALF_TRACK, p.z - fz * HALF_LEN + rz * HALF_TRACK);
    const y = (hFL + hFR + hBL + hBR) / 4;
    const pitch = Math.atan2((hFL + hFR) / 2 - (hBL + hBR) / 2, 2 * HALF_LEN);
    const roll = Math.atan2((hFL + hBL) / 2 - (hFR + hBR) / 2, 2 * HALF_TRACK);
    p.y += (y - p.y) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;
    this.root.position.copy(p);
    this.root.rotation.order = "YXZ";
    this.root.rotation.set(this.pitch, -this.yaw, -this.roll);
  }
}
