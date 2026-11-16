// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Lunar dust, the vacuum way (visual effect, simplified physics).
 *
 * In a vacuum, regolith kicked up by a boot or a wheel is NOT a cloud: each grain gets an
 * initial velocity and then follows a ballistic arc under gravity alone — no drag, no
 * wind, no lingering haze — and lands (NASA: "What hazards are caused by lunar
 * regolith?"; Apollo footage shows the clean "rooster tail" arcs behind the LRV wheels).
 *   x(t) = x0 + v0·t,   y(t) = y0 + vy0·t − ½·g·t²,   g = 1.62 m/s²
 * A grain is removed when it falls back to its launch height (t = 2·vy0/g), which is
 * where the local surface is. Electrostatic levitation is a separate process and is not
 * modelled. One pooled THREE.Points draw call; capped per graphics preset.
 */

import * as THREE from "three";
import { G_MOON } from "./player";

export class Dust {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private y0: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private alpha: Float32Array;
  private next = 0;
  private live = 0;
  enabled = true;

  constructor(max = 1500) {
    this.n = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.y0 = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.alpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xb9b3a8) }, scale: { value: 1100 } },
      vertexShader: /* glsl */ `
        attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(scale * 0.05 / -mv.z, 1.5, 9.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(color, vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.name = "dust";
  }

  setMax(max: number): void {
    this.enabled = max > 0;
    this.n = Math.max(1, Math.min(max, this.life.length));
    if (!this.enabled) this.clear();
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.live = 0;
    (this.points.geometry.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Launch `count` grains from (x, y, z) with mean velocity (vx, vy, vz) and spread. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, count: number, spread: number): void {
    if (!this.enabled) return;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const up = Math.max(0.2, vy + (Math.random() - 0.3) * spread);
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = y + 0.03;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.y0[i] = y;
      this.age[i] = 0;
      this.life[i] = (2 * up) / G_MOON; // lands back at launch height: pure ballistic flight time
      this.alpha[i] = 0.75;
    }
    this.live = Math.min(this.n, this.live + count);
  }

  update(dt: number): void {
    if (!this.live) return;
    let any = 0;
    const P = this.pos, V = this.vel, A = this.age, L = this.life, AL = this.alpha;
    for (let i = 0; i < this.n; i++) {
      const life = L[i] as number;
      if (life <= 0) continue;
      const age = (A[i] as number) + dt;
      A[i] = age;
      if (age >= life) {
        L[i] = 0;
        AL[i] = 0;
        continue;
      }
      any++;
      // exact ballistic step under lunar gravity, no drag
      const vy = (V[i * 3 + 1] as number) - G_MOON * dt;
      V[i * 3 + 1] = vy;
      P[i * 3] = (P[i * 3] as number) + (V[i * 3] as number) * dt;
      P[i * 3 + 1] = (P[i * 3 + 1] as number) + vy * dt;
      P[i * 3 + 2] = (P[i * 3 + 2] as number) + (V[i * 3 + 2] as number) * dt;
      AL[i] = 0.75 * Math.min(1, 4 * (1 - age / life));
    }
    this.live = any;
    const g = this.points.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  get active(): number {
    return this.live;
  }
}
