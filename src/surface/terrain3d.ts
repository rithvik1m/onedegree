// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Walkable terrain around a site, built from NASA LOLA elevation data.
 *
 * Layout (scripts/outpost.py): a polar grid centred on the site — 720 azimuths
 * (every 0.5°, clockwise from north) × rings (0–2 km every 10 m, then growing
 * 1.15 % per ring out to 220 km). Each sample is the LOLA height at the point
 * reached by walking `d` metres along a great circle at that azimuth: exactly the
 * rays the scientific skyline uses, so the mountains you see on the 3D horizon are
 * the ones the scanner measures.
 *
 * Scene frame: origin on the ground at the site, x = east, y = up, z = south
 * (so the camera's default −z looks north). A sample at surface distance d and
 * height h (relative to the site's ground g) sits at
 *   horizontal = (R+g+h)·sin(d/R),  y = (R+g+h)·cos(d/R) − (R+g)
 * i.e. true lunar curvature is built in (≈1.2 m drop at 2 km, ≈ 2.9 km at 100 km).
 */

import * as THREE from "three";
import { sampleGrid, toPolarXY, type TerrainGrid } from "../science/terrain";

export const MOON_R_M = 1_737_400;
const D2R = Math.PI / 180;

export type PatchKind = "lola" | "grid400" | "smooth";

export interface SurfacePatch {
  id: string;
  lon: number;
  lat: number;
  groundM: number;
  nAz: number;
  radii: Float64Array;
  nNear: number;
  /** rings × nAz heights (m) relative to groundM */
  h: Float32Array;
  kind: PatchKind;
  label: string;
}

export function ringRadii(): Float64Array {
  const r: number[] = [];
  for (let d = 0; d <= 2000 + 1e-6; d += 10) r.push(d);
  while ((r[r.length - 1] as number) < 220_000) r.push((r[r.length - 1] as number) * 1.0115);
  return Float64Array.from(r);
}

export interface PatchMeta {
  lon: number; lat: number; ground_m: number; n_az: number; radii_m: number[]; n_rings: number; n_near: number; dems: string[]; finest_to_m: Record<string, number>;
}

/** Precomputed LOLA patch (public/data/surface/<id>.{json,bin}). */
export async function loadPatch(id: string): Promise<SurfacePatch> {
  const meta = (await (await fetch(`/data/surface/${id}.json`)).json()) as PatchMeta;
  const buf = await (await fetch(`/data/surface/${id}.bin`)).arrayBuffer();
  return parsePatch(id, meta, buf);
}

export function parsePatch(id: string, meta: PatchMeta, buf: ArrayBuffer): SurfacePatch {
  const nA = meta.n_az;
  const near = new Float32Array(buf, 0, meta.n_near * nA);
  const far = new Int16Array(buf, meta.n_near * nA * 4, (meta.n_rings - meta.n_near) * nA);
  const h = new Float32Array(meta.n_rings * nA);
  h.set(near, 0);
  for (let i = 0; i < far.length; i++) h[meta.n_near * nA + i] = far[i] as number;
  const finest = Object.entries(meta.finest_to_m).find(([, v]) => v > 0)?.[0] ?? meta.dems[0] ?? "LOLA";
  const res = finest.includes("10MPP") ? "10 m" : finest.includes("20MPP") ? "20 m" : finest.includes("80MPP") ? "80 m" : finest.includes("118") ? "118 m (global LOLA)" : "240 m";
  return {
    id, lon: meta.lon, lat: meta.lat, groundM: meta.ground_m, nAz: nA, radii: Float64Array.from(meta.radii_m),
    nNear: meta.n_near, h, kind: "lola", label: `NASA LOLA terrain · ${res}${finest.includes("118") ? " · flat sphere beyond ~23 km" : " near field"}`,
  };
}

function destination(lon: number, lat: number, azRad: number, d: number): [number, number] {
  const p1 = lat * D2R, l1 = lon * D2R, dl = d / MOON_R_M;
  const sp2 = Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(azRad);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sp2)));
  const l2 = l1 + Math.atan2(Math.sin(azRad) * Math.sin(dl) * Math.cos(p1), Math.cos(dl) - Math.sin(p1) * sp2);
  return [l2 / D2R, p2 / D2R];
}

/** Any point south of ~80°S: same ring layout, sampled from the 400 m browser grid. */
export function patchFromGrid(grid: TerrainGrid, lon: number, lat: number, id = "custom"): SurfacePatch | null {
  const radii = ringRadii();
  const nA = 720;
  const [x0, y0] = toPolarXY(lon, lat);
  const g = sampleGrid(grid, x0, y0);
  if (!Number.isFinite(g)) return null;
  const h = new Float32Array(radii.length * nA);
  for (let j = 0; j < nA; j++) {
    const az = j * 0.5 * D2R;
    let last = 0;
    for (let i = 0; i < radii.length; i++) {
      const [lo, la] = destination(lon, lat, az, radii[i] as number);
      const [x, y] = toPolarXY(lo, la);
      const v = sampleGrid(grid, x, y);
      last = Number.isFinite(v) ? v - g : last;
      h[i * nA + j] = last;
    }
  }
  return { id, lon, lat, groundM: g, nAz: nA, radii, nNear: 201, h, kind: "grid400", label: "NASA LOLA terrain · 400 m grid (coarse: craters under ~1 km are not resolved)" };
}

/** Elsewhere: a smooth sphere, labelled as such. */
export function smoothPatch(lon: number, lat: number, id = "custom"): SurfacePatch {
  const radii = ringRadii();
  return { id, lon, lat, groundM: 0, nAz: 720, radii, nNear: 201, h: new Float32Array(radii.length * 720), kind: "smooth", label: "No terrain model loaded here — smooth sphere (geometric horizon only)" };
}

/** Scene position of ring i, azimuth column j. */
function vertex(p: SurfacePatch, i: number, j: number, out: Float32Array, k: number): void {
  const d = p.radii[i] as number;
  const hh = p.h[i * p.nAz + j] as number;
  const rr = MOON_R_M + p.groundM + hh;
  const del = d / MOON_R_M;
  const horiz = rr * Math.sin(del);
  const az = j * (360 / p.nAz) * D2R;
  out[k] = horiz * Math.sin(az);
  out[k + 1] = rr * Math.cos(del) - (MOON_R_M + p.groundM);
  out[k + 2] = -horiz * Math.cos(az);
}

/** Mesh over the given rings, every `azStep`-th azimuth (visual LOD; data untouched). */
function ringMesh(p: SurfacePatch, rings: number[], azStep: number): THREE.BufferGeometry {
  const nA = Math.floor(p.nAz / azStep);
  const nR = rings.length;
  const pos = new Float32Array(nR * nA * 3);
  for (let i = 0; i < nR; i++) for (let j = 0; j < nA; j++) vertex(p, rings[i] as number, j * azStep, pos, (i * nA + j) * 3);
  const idx = new Uint32Array((nR - 1) * nA * 6);
  let k = 0;
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < nA; j++) {
      const j1 = (j + 1) % nA;
      const a = i * nA + j, b = i * nA + j1, c = (i + 1) * nA + j, dd = (i + 1) * nA + j1;
      // counter-clockwise seen from above → normals point up
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = dd; idx[k++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  if (rings[0] === 0) {
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < nA; j++) { sx += n.getX(nA + j); sy += n.getY(nA + j); sz += n.getZ(nA + j); }
    const l = Math.hypot(sx, sy, sz) || 1;
    for (let j = 0; j < nA; j++) n.setXYZ(j, sx / l, sy / l, sz / l);
  }
  g.computeBoundingSphere();
  return g;
}

/**
 * Near mesh (0–2 km) and far mesh (2–220 km). `azStride` and `farRingStride` thin the
 * mesh for slower GPUs; collision (groundY) and every scientific horizon read the full
 * patch data, never the mesh.
 */
export function buildTerrain(p: SurfacePatch, nearMat: THREE.Material, farMat: THREE.Material, azStride = 1, farRingStride = 1): { near: THREE.Mesh; far: THREE.Mesh } {
  const nearRings = Array.from({ length: p.nNear }, (_, i) => i);
  const farRings: number[] = [];
  for (let i = p.nNear - 1; i < p.radii.length; i += farRingStride) farRings.push(i);
  if (farRings[farRings.length - 1] !== p.radii.length - 1) farRings.push(p.radii.length - 1);
  const near = new THREE.Mesh(ringMesh(p, nearRings, azStride), nearMat);
  const far = new THREE.Mesh(ringMesh(p, farRings, azStride), farMat);
  near.receiveShadow = true;
  near.castShadow = true;
  far.receiveShadow = true;
  far.castShadow = false;
  near.name = "terrain-near";
  far.name = "terrain-far";
  return { near, far };
}

/** Ring index (fractional) for surface distance d. */
function ringOf(p: SurfacePatch, d: number): number {
  const r = p.radii;
  const nearMax = r[p.nNear - 1] as number;
  if (d <= nearMax) return d / 10;
  let lo = p.nNear - 1, hi = r.length - 1;
  if (d >= (r[hi] as number)) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if ((r[m] as number) <= d) lo = m; else hi = m;
  }
  return lo + (d - (r[lo] as number)) / ((r[hi] as number) - (r[lo] as number));
}

/** Height (m, relative to the site's ground) at surface distance d, azimuth az (deg). */
export function heightRelAt(p: SurfacePatch, d: number, azDeg: number): number {
  const nA = p.nAz;
  const fi = Math.min(ringOf(p, d), p.radii.length - 1.000001);
  const i = Math.floor(fi), ti = fi - i;
  const fj = (((azDeg % 360) + 360) % 360) / (360 / nA);
  const j = Math.floor(fj) % nA, tj = fj - Math.floor(fj);
  const j1 = (j + 1) % nA;
  const H = p.h;
  const a = H[i * nA + j] as number, b = H[i * nA + j1] as number;
  const c = H[(i + 1) * nA + j] as number, e = H[(i + 1) * nA + j1] as number;
  return (a * (1 - tj) + b * tj) * (1 - ti) + (c * (1 - tj) + e * tj) * ti;
}

/** Scene y of the ground under scene (x, z). */
export function groundY(p: SurfacePatch, x: number, z: number): number {
  const rho = Math.hypot(x, z);
  const base = MOON_R_M + p.groundM;
  const del = Math.asin(Math.min(1, rho / base));
  const d = del * MOON_R_M;
  const az = Math.atan2(x, -z) / D2R;
  const hh = heightRelAt(p, d, az);
  return (base + hh) * Math.cos(del) - base;
}

/** Scene (x, z) → lon/lat on the Moon (great-circle inverse of the layout). */
export function sceneToLonLat(p: SurfacePatch, x: number, z: number): [number, number] {
  const rho = Math.hypot(x, z);
  if (rho < 1e-6) return [p.lon, p.lat];
  const d = Math.asin(Math.min(1, rho / (MOON_R_M + p.groundM))) * MOON_R_M;
  return destination(p.lon, p.lat, Math.atan2(x, -z), d);
}

/** Scene (x, z) of a lon/lat (bearing + distance from the site). */
export function lonLatToScene(p: SurfacePatch, lon: number, lat: number): [number, number] {
  const p1 = p.lat * D2R, p2 = lat * D2R, dl = (lon - p.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const brg = Math.atan2(y, x);
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  const d = Math.acos(Math.max(-1, Math.min(1, c))) * MOON_R_M;
  const horiz = (MOON_R_M + p.groundM) * Math.sin(d / MOON_R_M);
  return [horiz * Math.sin(brg), -horiz * Math.cos(brg)];
}

/**
 * Elevation angle of the terrain horizon seen from scene point (x, eyeY, z),
 * per 0.5° azimuth, considering only terrain farther than `minDist` metres.
 * Used to decide whether distant ridges shade the area around the player
 * (the shadow map handles nearby relief). Rendering aid — the scanner uses the
 * precomputed full-resolution skyline.
 */
export function farHorizon(p: SurfacePatch, x: number, z: number, eyeAbove: number, minDist: number, out: Float32Array): void {
  const nA = out.length;
  const y0 = groundY(p, x, z) + eyeAbove;
  const base = MOON_R_M + p.groundM;
  for (let j = 0; j < nA; j++) {
    const az = (j * 360) / nA;
    const sa = Math.sin(az * D2R), ca = Math.cos(az * D2R);
    let best = -90;
    for (let d = minDist; d < 200_000; d *= 1.02) {
      const px = x + d * sa, pz = z - d * ca;
      const rho = Math.hypot(px, pz);
      const del = Math.asin(Math.min(1, rho / base));
      const hh = heightRelAt(p, del * MOON_R_M, Math.atan2(px, -pz) / D2R);
      const rr = base + hh;
      // vector from eye to sample, in the eye's (approximately local) frame
      const sx = rr * Math.sin(del) * (px / (rho || 1)) - x;
      const sz = rr * Math.sin(del) * (pz / (rho || 1)) - z;
      const sy = rr * Math.cos(del) - base - y0;
      // the eye's own vertical tilts by its offset from the site; negligible within a few km
      const el = Math.atan2(sy, Math.hypot(sx, sz)) / D2R;
      if (el > best) best = el;
    }
    out[j] = best;
  }
}

/**
 * Terrain horizon elevation (deg) seen from scene (x, z) in ONE direction, counting
 * terrain farther than `minDist`. Used every few frames for the sun gate: one ray of
 * ~300 samples instead of a full 360° skyline, so moving never causes a hitch.
 */
export function horizonToward(p: SurfacePatch, x: number, z: number, eyeAbove: number, minDist: number, azDeg: number): number {
  const y0 = groundY(p, x, z) + eyeAbove;
  const base = MOON_R_M + p.groundM;
  const sa = Math.sin(azDeg * D2R), ca = Math.cos(azDeg * D2R);
  let best = -90;
  for (let d = minDist; d < 200_000; d = d < 40 ? d + 2 : d * 1.02) {
    const px = x + d * sa, pz = z - d * ca;
    const rho = Math.hypot(px, pz);
    const del = Math.asin(Math.min(1, rho / base));
    const hh = heightRelAt(p, del * MOON_R_M, Math.atan2(px, -pz) / D2R);
    const rr = base + hh;
    const sx = rr * Math.sin(del) * (px / (rho || 1)) - x;
    const sz = rr * Math.sin(del) * (pz / (rho || 1)) - z;
    const sy = rr * Math.cos(del) - base - y0;
    const el = Math.atan2(sy, Math.hypot(sx, sz)) / D2R;
    if (el > best) best = el;
  }
  return best;
}
