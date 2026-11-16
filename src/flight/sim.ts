// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Spacecraft flight dynamics — pure maths, no DOM, unit-tested (tests/flight.test.ts).
 *
 * Frame: Moon-fixed, Moon-centred, metres. x → (0°E, 0°N), y → (90°E, 0°N), z → north pole.
 * The Moon's slow rotation (one turn in 27.3 days) is neglected, so this frame is treated
 * as inertial — a stated simplification.
 * Gravity: point mass, GM = 4902.800 km³/s² (JPL DE440). No mascons, no Earth/Sun pull.
 * Integrator: velocity-Verlet with ≤ 0.05 s substeps (symplectic: orbits do not spiral).
 *
 * EXPLORER flight is ASSISTED, game-style flight: unlimited propellant, a strong engine
 * (up to 8 m/s²), a flight computer that holds attitude and vertical speed, and an
 * autopilot that flies to a chosen landing point. The trajectory it flies obeys the
 * gravity above, but the guidance is a simple feedback law, not mission-grade planning.
 */
import * as THREE from "three";

export const GM = 4.9028e12; // m³/s²
export const R_MOON = 1_737_400; // m (mean radius; same value the terrain uses)
export const A_MAX = 8; // m/s², Explorer engine (gameplay value)
const D2R = Math.PI / 180;

export interface Craft {
  r: THREE.Vector3; // position, m
  v: THREE.Vector3; // velocity, m/s
  q: THREE.Quaternion; // body → Moon-fixed
  w: THREE.Vector3; // body angular rate, rad/s
  thrust: number; // current engine acceleration, m/s² (along body +Y)
  dv: number; // Δv used, m/s
}

export function unitLL(lon: number, lat: number): THREE.Vector3 {
  const lo = lon * D2R, la = lat * D2R;
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

export function lonLatOf(r: THREE.Vector3): [number, number] {
  const n = r.length();
  return [Math.atan2(r.y, r.x) / D2R, Math.asin(Math.max(-1, Math.min(1, r.z / n))) / D2R];
}

/** Local basis at a site: columns east, up, south (= the surface scene's x, y, z). */
export function siteBasis(lon: number, lat: number): { east: THREE.Vector3; up: THREE.Vector3; south: THREE.Vector3; m: THREE.Matrix4; q: THREE.Quaternion } {
  const lo = lon * D2R, la = lat * D2R;
  const up = unitLL(lon, lat);
  const east = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
  const north = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const south = north.clone().negate();
  const m = new THREE.Matrix4().makeBasis(east, up, south);
  return { east, up, south, m, q: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/** A surface scene frame: origin at radius R + groundM above (lon, lat). Exact rigid transform. */
export class SceneFrame {
  readonly origin: THREE.Vector3;
  readonly basis: ReturnType<typeof siteBasis>;
  private qInv: THREE.Quaternion;
  constructor(readonly lon: number, readonly lat: number, readonly groundM: number) {
    this.basis = siteBasis(lon, lat);
    this.origin = this.basis.up.clone().multiplyScalar(R_MOON + groundM);
    this.qInv = this.basis.q.clone().invert();
  }
  toScene(r: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const d = r.clone().sub(this.origin);
    return out.set(d.dot(this.basis.east), d.dot(this.basis.up), d.dot(this.basis.south));
  }
  fromScene(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.origin).addScaledVector(this.basis.east, p.x).addScaledVector(this.basis.up, p.y).addScaledVector(this.basis.south, p.z);
  }
  dirToScene(v: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(v.dot(this.basis.east), v.dot(this.basis.up), v.dot(this.basis.south));
  }
  dirFromScene(v: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3().addScaledVector(this.basis.east, v.x).addScaledVector(this.basis.up, v.y).addScaledVector(this.basis.south, v.z);
  }
  quatToScene(q: THREE.Quaternion): THREE.Quaternion {
    return this.qInv.clone().multiply(q);
  }
  quatFromScene(q: THREE.Quaternion): THREE.Quaternion {
    return this.basis.q.clone().multiply(q);
  }
}

export function gravity(r: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const n = r.length();
  return out.copy(r).multiplyScalar(-GM / (n * n * n));
}

export const bodyUp = (q: THREE.Quaternion): THREE.Vector3 => new THREE.Vector3(0, 1, 0).applyQuaternion(q);
export const bodyFwd = (q: THREE.Quaternion): THREE.Vector3 => new THREE.Vector3(0, 0, -1).applyQuaternion(q);

/** Advance translation by dt with constant thrust (velocity-Verlet; gravity re-evaluated). */
export function stepTranslation(c: Craft, dt: number): void {
  const aT = bodyUp(c.q).multiplyScalar(c.thrust);
  const g0 = gravity(c.r);
  const a0 = g0.add(aT);
  c.r.addScaledVector(c.v, dt).addScaledVector(a0, 0.5 * dt * dt);
  const a1 = gravity(c.r).add(aT);
  c.v.addScaledVector(a0.add(a1), 0.5 * dt);
  c.dv += Math.abs(c.thrust) * dt;
}

/** Rotate by the body rate over dt. */
export function stepRotation(c: Craft, dt: number): void {
  const ang = c.w.length() * dt;
  if (ang < 1e-12) return;
  const dq = new THREE.Quaternion().setFromAxisAngle(c.w.clone().normalize(), ang);
  c.q.multiply(dq).normalize();
}

export interface Orbit {
  periAlt: number; // m above mean radius (−R if it intersects the centre)
  apoAlt: number; // m (Infinity if escaping)
  period: number; // s (NaN if escaping)
  energy: number; // J/kg
}

export function orbitOf(r: THREE.Vector3, v: THREE.Vector3): Orbit {
  const rn = r.length();
  const energy = v.lengthSq() / 2 - GM / rn;
  const h = r.clone().cross(v).length();
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (GM * GM)));
  if (energy >= 0) return { periAlt: (h * h) / (GM * (1 + e)) - R_MOON, apoAlt: Infinity, period: NaN, energy };
  const a = -GM / (2 * energy);
  return { periAlt: a * (1 - e) - R_MOON, apoAlt: a * (1 + e) - R_MOON, period: 2 * Math.PI * Math.sqrt((a * a * a) / GM), energy };
}

/** Great-circle distance (m, at mean radius) and initial bearing (rad, from north) between two directions. */
export function rangeBearing(from: THREE.Vector3, to: THREE.Vector3): { d: number; brg: number; dir: THREE.Vector3 } {
  const u = from.clone().normalize();
  const t = to.clone().normalize();
  const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(t))));
  // horizontal unit vector at `from` pointing along the great circle to `to`
  const dir = t.clone().addScaledVector(u, -u.dot(t));
  if (dir.lengthSq() < 1e-18) dir.set(0, 0, 0);
  else dir.normalize();
  const [lon, lat] = lonLatOf(u);
  const b = siteBasis(lon, lat);
  const brg = Math.atan2(dir.dot(b.east), -dir.dot(b.south));
  return { d: ang * R_MOON, brg, dir };
}

export interface Target {
  r: THREE.Vector3; // landing point (Moon-fixed, on the ground)
}

export interface GuidanceOut {
  acc: THREE.Vector3; // commanded acceleration (thrust only), m/s²
  phase: "climb" | "cruise" | "brake" | "descent" | "terminal" | "orbit";
  dist: number; // ground distance to target, m
  hAbove: number; // height above the target's ground radius, m
  warp: number; // suggested time warp
}

/**
 * Explorer autopilot: fly to `t` and land, or (t = null) climb to a circular orbit.
 * `clearance(r)` (optional) returns the terrain height above the target radius under / ahead
 * of the craft when local terrain is loaded, so the descent never cuts through a ridge.
 */
export function guidance(c: Craft, t: Target | null, orbitAlt = 60_000, clearance?: () => number): GuidanceOut {
  const rn = c.r.length();
  const up = c.r.clone().divideScalar(rn);
  const vUp = c.v.dot(up);
  const vH = c.v.clone().addScaledVector(up, -vUp);
  const gComp = up.clone().multiplyScalar(GM / (rn * rn));
  if (!t) {
    // orbit assist: reach orbitAlt with circular speed along the current heading
    const h = rn - R_MOON;
    const vc = Math.sqrt(GM / (R_MOON + orbitAlt));
    const head = vH.lengthSq() > 1 ? vH.clone().normalize() : bodyFwd(c.q).addScaledVector(up, -bodyFwd(c.q).dot(up)).normalize();
    const climb = Math.max(-60, Math.min(120, (orbitAlt - h) / 25));
    const vDes = head.multiplyScalar(h > 3000 ? vc : 0).addScaledVector(up, climb);
    const centri = vH.lengthSq() / rn;
    const acc = vDes.sub(c.v).divideScalar(4).add(gComp).addScaledVector(up, -centri);
    return { acc: clampLen(acc, A_MAX), phase: "orbit", dist: 0, hAbove: h, warp: Math.abs(h - orbitAlt) < 2000 ? 10 : 1 };
  }
  const tr = t.r.length();
  const hAbove = rn - tr;
  const { d, dir } = rangeBearing(c.r, t.r);
  const ground = d * (tr / R_MOON);
  // cruise height grows with distance; brake so the horizontal speed reaches 0 at the target
  const aBrake = 2.2;
  // never build horizontal speed before there is height to spare
  const vMaxH = Math.min(1550, Math.sqrt(2 * aBrake * Math.max(0, ground - 25)), 0.35 * ground + 2, 15 + Math.max(0, hAbove - Math.max(0, clearance ? clearance() : 0)) * 0.6);
  let hDes = Math.min(30_000, 120 + ground * 0.11);
  const terr = clearance ? clearance() : -Infinity;
  if (ground > 200) hDes = Math.max(hDes, terr + 180);
  let vzDes = Math.max(-80, Math.min(90, (hDes - hAbove) / 12));
  let phase: GuidanceOut["phase"] = vH.length() < vMaxH - 30 && ground > 3000 ? "climb" : ground > 20_000 ? "cruise" : ground > 1500 ? "brake" : "descent";
  if (ground < 60 && vH.length() < 3) {
    // terminal descent: slow steadily to touchdown at ~1 m/s
    vzDes = -Math.max(1.0, Math.min(25, hAbove * 0.18));
    phase = "terminal";
  }
  const vDes = dir.multiplyScalar(Math.max(0, vMaxH)).addScaledVector(up, vzDes);
  const centri = vH.lengthSq() / rn;
  const tau = phase === "terminal" ? 1 : phase === "descent" ? 2 : 4;
  const acc = allocate(vDes.sub(c.v).divideScalar(tau).add(gComp).addScaledVector(up, -centri), up);
  const warp = ground > 400_000 && hAbove > 8000 ? 50 : ground > 60_000 && hAbove > 6000 ? 20 : ground > 15_000 && hAbove > 2500 ? 10 : ground > 8000 && hAbove > 1500 ? 5 : ground > 2500 && hAbove > 700 ? 2 : 1;
  return { acc, phase, dist: ground, hAbove, warp };
}

/** Vertical first: the vertical demand gets the engine, the horizontal gets what is left. */
function allocate(acc: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
  const av = Math.max(0, Math.min(A_MAX, acc.dot(up)));
  const h = acc.clone().addScaledVector(up, -acc.dot(up));
  const room = Math.sqrt(Math.max(0, A_MAX * A_MAX - av * av));
  if (h.length() > room) h.setLength(room);
  return h.addScaledVector(up, av);
}

function clampLen(v: THREE.Vector3, m: number): THREE.Vector3 {
  const l = v.length();
  return l > m ? v.multiplyScalar(m / l) : v;
}

/**
 * Turn the body so +Y points along `want` (rate-limited), and return the thrust that the
 * engine can actually deliver along the current body axis (no thrust while pointing away).
 */
export function steerAndThrust(c: Craft, want: THREE.Vector3, dt: number, maxRate = 45 * D2R): number {
  const mag = want.length();
  if (mag < 1e-6) return 0;
  const cur = bodyUp(c.q);
  const tgt = want.clone().divideScalar(mag);
  const axis = cur.clone().cross(tgt);
  const s = axis.length();
  const ang = Math.atan2(s, cur.dot(tgt));
  if (s > 1e-9) {
    const step = Math.min(ang, maxRate * dt);
    const dq = new THREE.Quaternion().setFromAxisAngle(axis.divideScalar(s), step);
    c.q.premultiply(dq).normalize();
  }
  c.w.set(0, 0, 0);
  const cosA = bodyUp(c.q).dot(tgt);
  return cosA > 0.5 ? mag * cosA : 0;
}

/** Explorer "flight computer": thrust that holds a target vertical speed at the current tilt. */
export function holdVertical(c: Craft, vzTarget: number): number {
  const rn = c.r.length();
  const up = c.r.clone().divideScalar(rn);
  const vUp = c.v.dot(up);
  const vH2 = c.v.lengthSq() - vUp * vUp;
  const gEff = GM / (rn * rn) - vH2 / rn;
  const cosT = bodyUp(c.q).dot(up);
  if (cosT < 0.08) return 0;
  return Math.max(0, Math.min(A_MAX, (gEff + (vzTarget - vUp) / 1.5) / cosT));
}
