// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
// Terrain-mesh regression tests: the 2026-11-15 "torn terrain" report (89.547°S 177.735°E).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { buildTerrain, groundY, lonLatToScene, meshGroundY, parsePatch, patchFromGrid, sceneToLonLat, smoothPatch, terrainLod, validateTerrain, type PatchMeta, type SurfacePatch } from "../src/surface/terrain3d";
import type { TerrainGrid } from "../src/data";

const load = (id: string): SurfacePatch => {
  const meta = JSON.parse(readFileSync(`public/data/surface/${id}.json`, "utf8")) as PatchMeta;
  const bin = readFileSync(`public/data/surface/${id}.bin`);
  return parsePatch(id, meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
};
const gmeta = JSON.parse(readFileSync("public/data/terrain/south_pole_400m.json", "utf8")) as { width: number; height: number; x0: number; y0: number; px_m: number };
const gbin = readFileSync("public/data/terrain/south_pole_400m.bin");
const grid: TerrainGrid = { width: gmeta.width, height: gmeta.height, x0: gmeta.x0, y0: gmeta.y0, px: gmeta.px_m, data: new Int16Array(gbin.buffer.slice(gbin.byteOffset, gbin.byteOffset + gbin.byteLength)) };

const PRESETS: [string, number, number][] = [["high", 1, 1], ["balanced", 2, 2], ["low", 2, 3]];
const mat = new THREE.MeshBasicMaterial();
const REPORTED = { lon: 177.735, lat: -89.547 };

const patches: [string, SurfacePatch][] = [
  ...["outpost", "shadow", "earthlink", "a11", "a15", "a17", "im1", "im2"].map((id) => [id, load(id)] as [string, SurfacePatch]),
  ["grid@reported-point", patchFromGrid(grid, REPORTED.lon, REPORTED.lat) as SurfacePatch],
  ["grid@-85,0", patchFromGrid(grid, 0, -85) as SurfacePatch],
  ["grid@-85,180", patchFromGrid(grid, 180, -85) as SurfacePatch],
  ["grid@-85,-179.99", patchFromGrid(grid, -179.99, -85) as SurfacePatch],
  ["grid@-89.99,90", patchFromGrid(grid, 90, -89.99) as SurfacePatch],
  ["smooth@0,0", smoothPatch(0, 0)],
  ["smooth@0,180", smoothPatch(180, 0)],
];

describe("terrain meshes are valid everywhere (holes / torn triangles regression)", () => {
  it("every region and probe location has a finite height field", () => {
    for (const [name, p] of patches) {
      expect(p, name).toBeTruthy();
      let bad = 0;
      for (const v of p.h) if (!Number.isFinite(v)) bad++;
      expect(bad, name).toBe(0);
      expect(Number.isFinite(p.groundM), name).toBe(true);
    }
  });

  for (const [preset, az, ring] of PRESETS) {
    it(`${preset}: near and far meshes pass validation (finite, indices in range, up-facing, no stretched triangles)`, () => {
      for (const [name, p] of patches) {
        const { near, far, lod } = buildTerrain(p, mat, mat, az, ring);
        expect(validateTerrain(near.geometry, p, lod.nearRings, az), `${name} near`).toEqual([]);
        expect(validateTerrain(far.geometry, p, lod.farRings, az), `${name} far`).toEqual([]);
        // the two meshes share their seam ring exactly (no cracks)
        expect(lod.farRings[0]).toBe(lod.nearRings[lod.nearRings.length - 1]);
        near.geometry.dispose();
        far.geometry.dispose();
      }
    });
  }

  it("the walkable surface is continuous across the 2 km near/far seam and matches the data at mesh vertices", () => {
    const p = load("outpost");
    for (const [, az, ring] of PRESETS) {
      const lod = terrainLod(p, az, ring);
      const seam = p.radii[p.nNear - 1] as number;
      for (let a = 0; a < 360; a += 7) {
        const sx = Math.sin((a * Math.PI) / 180), sz = -Math.cos((a * Math.PI) / 180);
        const inside = meshGroundY(p, lod, sx * (seam - 0.01), sz * (seam - 0.01));
        const outside = meshGroundY(p, lod, sx * (seam + 0.01), sz * (seam + 0.01));
        expect(Math.abs(inside - outside)).toBeLessThan(0.05);
      }
      // at an actual mesh vertex the rendered surface equals the measured data
      const j = 40 * az, i = lod.farRings[30] as number;
      const d = p.radii[i] as number;
      const azr = (j * 0.5 * Math.PI) / 180;
      const del = d / 1_737_400;
      const rho = (1_737_400 + p.groundM) * Math.sin(del);
      const x = rho * Math.sin(azr), z = -rho * Math.cos(azr);
      expect(Math.abs(meshGroundY(p, lod, x, z) - groundY(p, x, z))).toBeLessThan(0.05);
    }
  });

  it("the reported point (5.76 km from the outpost centre) lies on rendered terrain, close to the data", () => {
    const p = load("outpost");
    const [x, z] = lonLatToScene(p, REPORTED.lon, REPORTED.lat);
    expect(Math.hypot(x, z)).toBeGreaterThan(5000);
    const lod = terrainLod(p, 2, 2);
    const y = meshGroundY(p, lod, x, z);
    expect(Number.isFinite(y)).toBe(true);
    // the coarser mesh stays within a few metres of the full-resolution data there
    expect(Math.abs(y - groundY(p, x, z))).toBeLessThan(6);
    const [lo, la] = sceneToLonLat(p, x, z);
    expect(Math.abs(la - REPORTED.lat)).toBeLessThan(1e-6);
    expect(Math.abs(((lo - REPORTED.lon + 540) % 360) - 180)).toBeLessThan(1e-4);
  });

  it("scene ⇄ lon/lat round-trips near 0°, ±180° and the pole", () => {
    for (const [lon, lat] of [[0, -85.2], [179.999, -85], [-179.999, -85], [180, -89.95], [90, -89.999]] as [number, number][]) {
      const p = patchFromGrid(grid, lon, lat) as SurfacePatch;
      for (const [dx, dz] of [[1200, -300], [-25000, 4000], [0, 90000]] as [number, number][]) {
        const [lo, la] = sceneToLonLat(p, dx, dz);
        const [x2, z2] = lonLatToScene(p, lo, la);
        expect(Math.hypot(x2 - dx, z2 - dz)).toBeLessThan(0.5);
      }
    }
  });
});
