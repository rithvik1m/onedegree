// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSkyline, elevationAngleDeg, fromPolarXY, horizonAt, smoothHorizonDeg, toPolarXY, type TerrainGrid } from "../src/science/terrain";
import { discFractionAbove, longestRun, metrics, visibility } from "../src/science/visibility";
import type { SkyTrack } from "../src/science/sky";

const R_M = 1_737_400;

function flatGrid(px = 400, half = 304_000, height = 0): TerrainGrid {
  const w = Math.round((2 * half) / px);
  return { width: w, height: w, x0: -half, y0: half, px, data: new Int16Array(w * w).fill(height) };
}

describe("polar projection", () => {
  const pts = JSON.parse(readFileSync("public/data/validation/projection_points.json", "utf8")) as { lon: number; lat: number; x: number; y: number }[];
  it("matches PROJ's south polar stereographic to a millimetre", () => {
    for (const p of pts) {
      const [x, y] = toPolarXY(p.lon, p.lat);
      expect(Math.abs(x - p.x)).toBeLessThan(0.001);
      expect(Math.abs(y - p.y)).toBeLessThan(0.001);
    }
  });
  it("round-trips", () => {
    const [x, y] = toPolarXY(29.13, -84.78);
    const [lon, lat] = fromPolarXY(x, y);
    expect(lon).toBeCloseTo(29.13, 9);
    expect(lat).toBeCloseTo(-84.78, 9);
  });
});

describe("skyline geometry (synthetic terrain)", () => {
  it("a perfectly flat Moon gives the geometric dip for a 2 m eye", () => {
    const sky = computeSkyline(flatGrid(), 0, -89.5, 2, 100);
    expect(sky).not.toBeNull();
    const expected = smoothHorizonDeg(2); // about -0.087 deg
    expect(expected).toBeCloseTo(-0.0870, 3);
    for (const v of sky!.horizon) expect(Math.abs(v - expected)).toBeLessThan(0.01);
  });

  it("a single wall at a known bearing and distance gives the exact curved-Earth angle", () => {
    const g = flatGrid();
    // Put a 2,000 m wall due "grid north" of the site, 30 km away.
    const [sx, sy] = toPolarXY(0, -89.0); // site on the lon=0 meridian, so grid +y is away from the pole
    const wallY = sy + 30_000;
    const r0 = Math.floor((g.y0 - wallY) / g.px);
    for (let r = r0 - 1; r <= r0; r++) for (let c = 0; c < g.width; c++) g.data[r * g.width + c] = 2000;
    const sky = computeSkyline(g, 0, -89.0, 2, 100)!;
    // Away from the pole along lon=0 is local north (azimuth 0).
    const got = horizonAt(sky.horizon, 0);
    const nearEdge = (g.y0 - (r0 + 1) * g.px) - sy; // distance to the wall's near face along the ray
    const expected = elevationAngleDeg(0, 2, 2000, nearEdge);
    expect(Math.abs(got - expected)).toBeLessThan(0.1); // 400 m sampling of a 2-cell wall
    expect(got).toBeGreaterThan(3); // a 2 km wall at 30 km is ~3.8 deg up
    // Looking the other way (toward the pole) sees flat ground.
    expect(horizonAt(sky.horizon, 180)).toBeLessThan(0);
    void sx;
  });

  it("curvature: a peak far enough away sinks below the level horizon", () => {
    // 1,000 m at 150 km: drop d^2/2R = 6.5 km, so it is below 0 deg.
    expect(elevationAngleDeg(0, 2, 1000, 150_000)).toBeLessThan(0);
    // A negative absolute height can still be above the local level when close.
    expect(elevationAngleDeg(-3000, 2, -2500, 5_000)).toBeGreaterThan(5);
    void R_M;
  });
});

describe("Sun disc against the skyline", () => {
  const r = 0.2666;
  it("is full, half and empty at +r, 0 and -r", () => {
    expect(discFractionAbove(1 + r, 1, r)).toBe(1);
    expect(discFractionAbove(1, 1, r)).toBeCloseTo(0.5, 12);
    expect(discFractionAbove(1 - r, 1, r)).toBeCloseTo(0, 12);
  });
  it("is symmetric", () => {
    expect(discFractionAbove(1.1, 1, r) + discFractionAbove(0.9, 1, r)).toBeCloseTo(1, 12);
  });
});

describe("metrics", () => {
  it("finds the longest dark run and flags runs that touch the window edge", () => {
    const run = longestRun(Uint8Array.from([1, 0, 0, 1, 0, 0, 0]), 0);
    expect(run.length).toBe(3);
    expect(run.open).toBe(true);
    const inner = longestRun(Uint8Array.from([1, 0, 0, 0, 1, 0, 1]), 0);
    expect(inner).toEqual({ startIndex: 1, length: 3, open: false });
  });

  it("computes percentages from the same arrays the timeline draws", () => {
    const n = 4;
    const track: SkyTrack = {
      t0: 0, stepS: 3600, n,
      sunAz: Float32Array.from([0, 90, 180, 270]), sunEl: Float32Array.from([2, 2, -2, 2]),
      earthAz: Float32Array.from([0, 0, 0, 0]), earthEl: Float32Array.from([1, -1, 1, 1]),
    };
    const horizon = new Float32Array(720).fill(0);
    const m = metrics(visibility(track, horizon, -0.087));
    expect(m.sunlitPct).toBe(75);
    expect(m.earthPct).toBe(75);
    expect(m.bothPct).toBe(50);
    expect(m.longestDarkH).toBe(1);
  });
});
