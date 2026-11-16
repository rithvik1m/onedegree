// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GM, R_MOON, SceneFrame, guidance, holdVertical, orbitOf, rangeBearing, siteBasis, steerAndThrust, stepTranslation, unitLL, type Craft } from "../src/flight/sim";
import { lonLatToScene, type SurfacePatch } from "../src/surface/terrain3d";
import sites from "../public/data/sites.json";

const site = (id: string): { lon: number; lat: number } => (sites.sites as { id: string; lon: number; lat: number }[]).find((s) => s.id === id) as { lon: number; lat: number };

function landedAt(lon: number, lat: number, ground = 0): Craft {
  const b = siteBasis(lon, lat);
  return { r: b.up.clone().multiplyScalar(R_MOON + ground), v: new THREE.Vector3(), q: b.q.clone(), w: new THREE.Vector3(), thrust: 0, dv: 0 };
}

/** Fly the Explorer autopilot; returns the touchdown state. */
function autopilot(c: Craft, target: THREE.Vector3, maxT = 4 * 3600): { t: number; miss: number; vTouch: number; maxWarp: number } {
  let t = 0, maxWarp = 1;
  const tr = target.length();
  while (t < maxT) {
    const g = guidance(c, { r: target });
    maxWarp = Math.max(maxWarp, g.warp);
    const dt = 0.05;
    c.thrust = steerAndThrust(c, g.acc, dt);
    stepTranslation(c, dt);
    t += dt;
    if (c.r.length() <= tr && t > 5) break;
  }
  const up = c.r.clone().normalize();
  return { t, miss: rangeBearing(c.r, target).d, vTouch: Math.abs(c.v.dot(up)) + 0 * c.v.length(), maxWarp };
}

describe("spacecraft flight dynamics (src/flight/sim.ts)", () => {
  it("free fall from 10 m takes √(2h/g) with g = GM/R²", () => {
    const c = landedAt(0, 0);
    c.r.multiplyScalar((R_MOON + 10) / R_MOON);
    let t = 0;
    while (c.r.length() > R_MOON) { stepTranslation(c, 0.001); t += 0.001; }
    const g = GM / (R_MOON * R_MOON);
    expect(g).toBeCloseTo(1.624, 3);
    expect(Math.abs(t - Math.sqrt(20 / g))).toBeLessThan(0.005);
  });

  it("a circular 100 km orbit closes after one period and conserves energy", () => {
    const r0 = R_MOON + 100_000;
    const c: Craft = { r: new THREE.Vector3(r0, 0, 0), v: new THREE.Vector3(0, 0, Math.sqrt(GM / r0)), q: new THREE.Quaternion(), w: new THREE.Vector3(), thrust: 0, dv: 0 };
    const o = orbitOf(c.r, c.v);
    const T = 2 * Math.PI * Math.sqrt(r0 ** 3 / GM);
    expect(Math.abs(o.period - T)).toBeLessThan(1e-6 * T);
    expect(T / 60).toBeCloseTo(117.8, 0);
    const e0 = o.energy;
    const n = Math.round(T / 0.05);
    for (let i = 0; i < n; i++) stepTranslation(c, T / n);
    expect(c.r.distanceTo(new THREE.Vector3(r0, 0, 0))).toBeLessThan(50);
    expect(Math.abs((orbitOf(c.r, c.v).energy - e0) / e0)).toBeLessThan(1e-8);
  });

  it("the scene frame is the surface scene's frame (east, up, south) exactly", () => {
    const op = site("outpost");
    const patch = { lon: op.lon, lat: op.lat, groundM: 1900 } as SurfacePatch;
    const f = new SceneFrame(op.lon, op.lat, 1900);
    const s1 = site("survey");
    const [x, z] = lonLatToScene(patch, s1.lon, s1.lat);
    const r = unitLL(s1.lon, s1.lat).multiplyScalar(R_MOON + 1900);
    const p = f.toScene(r);
    // same horizontal position (the scene uses the curved-Earth formula; y is the curvature drop)
    expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(0.05);
    expect(f.fromScene(p).distanceTo(r)).toBeLessThan(1e-6);
  });

  it("the Explorer flight computer holds a hover", () => {
    const c = landedAt(30, -45);
    c.r.multiplyScalar((R_MOON + 100) / R_MOON);
    for (let i = 0; i < 1200; i++) { c.thrust = holdVertical(c, 0); stepTranslation(c, 0.05); }
    expect(Math.abs(c.r.length() - R_MOON - 100)).toBeLessThan(0.5);
  });

  it("autopilot: Outpost → Shadow Station lands on target, softly", () => {
    const a = site("outpost"), b = site("shadow");
    const c = landedAt(a.lon, a.lat);
    const res = autopilot(c, unitLL(b.lon, b.lat).multiplyScalar(R_MOON));
    expect(res.miss).toBeLessThan(15);
    expect(res.vTouch).toBeLessThan(2.0);
    expect(res.t).toBeLessThan(25 * 60);
  });

  it("autopilot: Outpost → Apollo 11 (≈2,700 km) lands on target", () => {
    const a = site("outpost"), b = site("a11");
    const c = landedAt(a.lon, a.lat);
    const res = autopilot(c, unitLL(b.lon, b.lat).multiplyScalar(R_MOON), 6 * 3600);
    expect(res.miss).toBeLessThan(25);
    expect(res.vTouch).toBeLessThan(2.0);
    expect(res.maxWarp).toBeGreaterThanOrEqual(20);
  });

  it("orbit assist reaches a closed orbit above 40 km", () => {
    const c = landedAt(0, -89);
    let t = 0;
    while (t < 1800) { const g = guidance(c, null, 60_000); c.thrust = steerAndThrust(c, g.acc, 0.05); stepTranslation(c, 0.05); t += 0.05; }
    const o = orbitOf(c.r, c.v);
    expect(o.periAlt).toBeGreaterThan(40_000);
    expect(o.apoAlt).toBeLessThan(90_000);
  });
});
