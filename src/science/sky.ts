// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Sun and Earth in the sky of any point on the Moon.
 *
 * Input: one NASA/JPL Horizons table (scripts/fetch_horizons.py) giving, hourly,
 * the apparent sub-solar and sub-Earth points on the Moon (planetodetic, east
 * longitude) and the Earth–Moon distance. A sub-point is the spot where that body
 * is straight overhead, so it is also the body's direction in the Moon's
 * body-fixed frame. From there, azimuth/elevation at a surface point is plain
 * vector maths in the observer's local east/north/up frame.
 *
 * Verified, not assumed: tests/sky.test.ts and the in-app Reality Check compare
 * this against Horizons' own topocentric answers (observer ON the Moon).
 *
 * Conventions: degrees in, degrees out. Azimuth from local north, increasing
 * toward east, in [0, 360). Elevation above the observer's local horizontal
 * (the smooth-sphere horizon), negative below it. Moon: sphere of 1737.4 km,
 * the radius used by the LOLA DEMs and by Horizons for lunar sites.
 */

export const MOON_R_KM = 1737.4;
export const AU_KM = 149_597_870.7;
/** Apparent angular radius of the Sun seen from the Moon (deg); varies ±1.7 % over a year. */
export const SUN_RADIUS_DEG = 0.2666;
/** Mean apparent angular radius of Earth seen from the Moon (deg). */
export const EARTH_RADIUS_DEG = 0.95;

export type Vec3 = [number, number, number];

export interface SubpointTable {
  source: string;
  retrieved_utc: string;
  start_unix: number;
  step_s: number;
  n: number;
  obsLon: number[];
  obsLat: number[];
  sunLon: number[];
  sunLat: number[];
  distKm: number[];
}

export interface Subpoints {
  obsLon: number;
  obsLat: number;
  sunLon: number;
  sunLat: number;
  distKm: number;
}

export interface AzEl {
  az: number;
  el: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function unitFromLonLat(lonDeg: number, latDeg: number): Vec3 {
  const lo = lonDeg * D2R;
  const la = latDeg * D2R;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Interpolate two angles in degrees the short way round (359 → 1 passes 0, not 180). */
export function lerpAngleDeg(a: number, b: number, f: number): number {
  let d = (((b - a) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  const v = a + d * f;
  return ((v % 360) + 360) % 360;
}

export function tableCovers(table: SubpointTable, unix: number): boolean {
  return unix >= table.start_unix && unix <= table.start_unix + (table.n - 1) * table.step_s;
}

/** Sub-points at an arbitrary instant, linearly interpolated between hourly rows. */
export function subpointsAt(table: SubpointTable, unix: number): Subpoints | null {
  if (!tableCovers(table, unix)) return null;
  const x = (unix - table.start_unix) / table.step_s;
  const i = Math.min(Math.floor(x), table.n - 2);
  const f = x - i;
  const g = (arr: number[], k: number): number => arr[k] as number;
  return {
    obsLon: lerpAngleDeg(g(table.obsLon, i), g(table.obsLon, i + 1), f),
    obsLat: g(table.obsLat, i) + (g(table.obsLat, i + 1) - g(table.obsLat, i)) * f,
    sunLon: lerpAngleDeg(g(table.sunLon, i), g(table.sunLon, i + 1), f),
    sunLat: g(table.sunLat, i) + (g(table.sunLat, i + 1) - g(table.sunLat, i)) * f,
    distKm: g(table.distKm, i) + (g(table.distKm, i + 1) - g(table.distKm, i)) * f,
  };
}

export interface LocalFrame {
  up: Vec3;
  east: Vec3;
  north: Vec3;
  /** Observer position in the Moon body-fixed frame, km. */
  pos: Vec3;
}

export function localFrame(lonDeg: number, latDeg: number, heightKm = 0): LocalFrame {
  const up = unitFromLonLat(lonDeg, latDeg);
  const lo = lonDeg * D2R;
  const la = latDeg * D2R;
  const east: Vec3 = [-Math.sin(lo), Math.cos(lo), 0];
  const north: Vec3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const r = MOON_R_KM + heightKm;
  return { up, east, north, pos: [up[0] * r, up[1] * r, up[2] * r] };
}

/** Azimuth/elevation of a target given in the Moon body-fixed frame (km). */
export function azElOf(frame: LocalFrame, targetKm: Vec3): AzEl {
  const d: Vec3 = [targetKm[0] - frame.pos[0], targetKm[1] - frame.pos[1], targetKm[2] - frame.pos[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  const u: Vec3 = [d[0] / n, d[1] / n, d[2] / n];
  const el = Math.asin(Math.max(-1, Math.min(1, dot(u, frame.up)))) * R2D;
  let az = Math.atan2(dot(u, frame.east), dot(u, frame.north)) * R2D;
  if (az < 0) az += 360;
  return { az, el };
}

export function sunVectorKm(s: Subpoints): Vec3 {
  const u = unitFromLonLat(s.sunLon, s.sunLat);
  return [u[0] * AU_KM, u[1] * AU_KM, u[2] * AU_KM];
}

export function earthVectorKm(s: Subpoints): Vec3 {
  const u = unitFromLonLat(s.obsLon, s.obsLat);
  return [u[0] * s.distKm, u[1] * s.distKm, u[2] * s.distKm];
}

export interface SkyAt {
  sun: AzEl;
  earth: AzEl;
}

export function skyAt(table: SubpointTable, unix: number, lonDeg: number, latDeg: number, heightKm = 0): SkyAt | null {
  const s = subpointsAt(table, unix);
  if (!s) return null;
  const f = localFrame(lonDeg, latDeg, heightKm);
  return { sun: azElOf(f, sunVectorKm(s)), earth: azElOf(f, earthVectorKm(s)) };
}

export interface SkyTrack {
  t0: number;
  stepS: number;
  n: number;
  sunAz: Float32Array;
  sunEl: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
}

/** Sun/Earth positions over a window at a fixed cadence, for one site. */
export function skyTrack(table: SubpointTable, t0: number, hours: number, stepS: number, lonDeg: number, latDeg: number, heightKm = 0): SkyTrack {
  const n = Math.max(1, Math.floor((hours * 3600) / stepS) + 1);
  const track: SkyTrack = {
    t0,
    stepS,
    n,
    sunAz: new Float32Array(n),
    sunEl: new Float32Array(n),
    earthAz: new Float32Array(n),
    earthEl: new Float32Array(n),
  };
  const f = localFrame(lonDeg, latDeg, heightKm);
  for (let i = 0; i < n; i++) {
    const s = subpointsAt(table, t0 + i * stepS);
    if (!s) {
      track.sunEl[i] = Number.NaN;
      track.earthEl[i] = Number.NaN;
      continue;
    }
    const sun = azElOf(f, sunVectorKm(s));
    const earth = azElOf(f, earthVectorKm(s));
    track.sunAz[i] = sun.az;
    track.sunEl[i] = sun.el;
    track.earthAz[i] = earth.az;
    track.earthEl[i] = earth.el;
  }
  return track;
}

/** Great-circle angle between two sky directions (deg) — the honest error measure. */
export function angularSeparationDeg(a: AzEl, b: AzEl): number {
  const ua = unitFromLonLat(a.az, a.el);
  const ub = unitFromLonLat(b.az, b.el);
  const c = Math.max(-1, Math.min(1, dot(ua, ub)));
  // acos loses precision for tiny angles; use the chord form instead.
  const dx = ua[0] - ub[0];
  const dy = ua[1] - ub[1];
  const dz = ua[2] - ub[2];
  const chord = Math.hypot(dx, dy, dz);
  return c > 0.9 ? 2 * Math.asin(chord / 2) * R2D : Math.acos(c) * R2D;
}
