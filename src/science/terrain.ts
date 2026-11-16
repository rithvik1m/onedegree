// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Terrain skylines in the browser, for points that have no precomputed profile.
 *
 * Same method as scripts/compute_horizons.py (great-circle rays, exact curvature,
 * maximum elevation angle per azimuth) but on a coarser grid: NASA Goddard's
 * LDEM_80S_80MPP_ADJ averaged to 400 m (public/data/terrain/south_pole_400m.*),
 * covering roughly 80-90 S. Precomputed site profiles (20/80/240 m) are always
 * preferred; Reality Check reports how much the 400 m grid differs from them.
 */

import { MOON_R_KM } from "./sky";

const R_M = MOON_R_KM * 1000;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const N_AZ = 720;
export const AZ_STEP = 360 / N_AZ;

export interface TerrainGrid {
  width: number;
  height: number;
  x0: number;
  y0: number;
  px: number;
  data: Int16Array;
}

export interface Skyline {
  /** Highest terrain elevation angle per 0.5 deg of azimuth (deg). */
  horizon: Float32Array;
  /** Distance to the ridge that sets the skyline in each direction (km). */
  obstructionKm: Float32Array;
  /** Shortest distance at which any ray ran out of terrain data (km). */
  coverageKmMin: number;
  groundM: number;
  eyeM: number;
  source: string;
  resolution: string;
}

/** South polar stereographic (true scale at the pole), checked against PROJ. */
export function toPolarXY(lonDeg: number, latDeg: number): [number, number] {
  const rho = 2 * R_M * Math.tan(Math.PI / 4 + (latDeg * D2R) / 2);
  return [rho * Math.sin(lonDeg * D2R), rho * Math.cos(lonDeg * D2R)];
}

export function fromPolarXY(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y);
  const lat = (2 * Math.atan(rho / (2 * R_M)) - Math.PI / 2) * R2D;
  let lon = Math.atan2(x, y) * R2D;
  if (lon < 0) lon += 360;
  return [lon, lat];
}

const NO_DATA = -32768;

/** Bilinear height (m) at projected x/y; NaN outside the grid or on no-data. */
export function sampleGrid(g: TerrainGrid, x: number, y: number): number {
  const c = (x - g.x0) / g.px - 0.5;
  const r = (g.y0 - y) / g.px - 0.5;
  if (!(c >= 0 && r >= 0 && c <= g.width - 1 && r <= g.height - 1)) return Number.NaN;
  const c0 = Math.min(Math.floor(c), g.width - 2);
  const r0 = Math.min(Math.floor(r), g.height - 2);
  const fc = c - c0;
  const fr = r - r0;
  const i = r0 * g.width + c0;
  const a = g.data[i] as number;
  const b = g.data[i + 1] as number;
  const d = g.data[i + g.width] as number;
  const e = g.data[i + g.width + 1] as number;
  if (a === NO_DATA || b === NO_DATA || d === NO_DATA || e === NO_DATA) return Number.NaN;
  return (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr;
}

export function groundHeight(g: TerrainGrid, lonDeg: number, latDeg: number): number {
  const [x, y] = toPolarXY(lonDeg, latDeg);
  return sampleGrid(g, x, y);
}

/** Exact elevation angle of a terrain point seen from an observer (deg). */
export function elevationAngleDeg(groundM: number, eyeM: number, targetM: number, distM: number): number {
  const delta = distM / R_M;
  const ro = R_M + groundM + eyeM;
  const rt = R_M + targetM;
  return Math.atan2(rt * Math.cos(delta) - ro, rt * Math.sin(delta)) * R2D;
}

/** Dip of the smooth-sphere horizon for an eye height above the surface (deg, negative). */
export function smoothHorizonDeg(eyeM: number): number {
  return -Math.acos(R_M / (R_M + eyeM)) * R2D;
}

export function computeSkyline(g: TerrainGrid, lonDeg: number, latDeg: number, eyeM = 2, maxKm = 260): Skyline | null {
  const ground = groundHeight(g, lonDeg, latDeg);
  if (Number.isNaN(ground)) return null;
  const step = g.px;
  const nd = Math.floor((maxKm * 1000) / step);
  const horizon = new Float32Array(N_AZ);
  const obstruction = new Float32Array(N_AZ);
  let coverageMin = Infinity;
  const phi1 = latDeg * D2R;
  const lam1 = lonDeg * D2R;
  const sinP1 = Math.sin(phi1);
  const cosP1 = Math.cos(phi1);
  const ro = R_M + ground + eyeM;
  for (let k = 0; k < N_AZ; k++) {
    const az = k * AZ_STEP * D2R;
    const sinAz = Math.sin(az);
    const cosAz = Math.cos(az);
    let best = -90;
    let bestD = 0;
    let lastValid = 0;
    for (let j = 1; j <= nd; j++) {
      const d = j * step - step / 2;
      const delta = d / R_M;
      const sinD = Math.sin(delta);
      const cosD = Math.cos(delta);
      const sinP2 = sinP1 * cosD + cosP1 * sinD * cosAz;
      const phi2 = Math.asin(sinP2);
      const lam2 = lam1 + Math.atan2(sinAz * sinD * cosP1, cosD - sinP1 * sinP2);
      const rho = 2 * R_M * Math.tan(Math.PI / 4 + phi2 / 2);
      const h = sampleGrid(g, rho * Math.sin(lam2), rho * Math.cos(lam2));
      if (Number.isNaN(h)) break;
      lastValid = d;
      const rt = R_M + h;
      const el = Math.atan2(rt * cosD - ro, rt * sinD) * R2D;
      if (el > best) {
        best = el;
        bestD = d;
      }
    }
    horizon[k] = best;
    obstruction[k] = bestD / 1000;
    coverageMin = Math.min(coverageMin, lastValid / 1000);
  }
  return {
    horizon,
    obstructionKm: obstruction,
    coverageKmMin: coverageMin,
    groundM: ground,
    eyeM,
    source: "NASA Goddard LDEM_80S_80MPP_ADJ, averaged to 400 m (in-browser)",
    resolution: "400 m",
  };
}

/** Skyline height at any azimuth, interpolated between the 0.5 deg samples. */
export function horizonAt(horizon: ArrayLike<number>, azDeg: number): number {
  const n = horizon.length;
  const x = ((((azDeg % 360) + 360) % 360) / 360) * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  const a = horizon[i] as number;
  const b = horizon[(i + 1) % n] as number;
  return a + (b - a) * f;
}

export interface PrecomputedProfile {
  id: string;
  name: string;
  lon: number;
  lat: number;
  ground_m: number;
  eye_m: number;
  horizon_deg: number[];
  obstruction_km: number[];
  coverage_km_min: number;
  dems: string[];
  method: string;
  computed_utc: string;
}

export function skylineFromProfile(p: PrecomputedProfile): Skyline {
  return {
    horizon: Float32Array.from(p.horizon_deg),
    obstructionKm: Float32Array.from(p.obstruction_km),
    coverageKmMin: p.coverage_km_min,
    groundM: p.ground_m,
    eyeM: p.eye_m,
    source: `NASA Goddard LOLA DEMs (precomputed): ${p.dems.join("; ")}`,
    resolution: p.dems[0]?.includes("10 m") ? "10 m near / 20 m / 80 m / 240 m far" : p.dems[0]?.includes("20 m") ? "20 m near / 80 m / 240 m far" : p.dems[0]?.includes("80 m") ? "80 m / 240 m far" : "240 m",
  };
}
