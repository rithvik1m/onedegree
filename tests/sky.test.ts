import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { angularSeparationDeg, lerpAngleDeg, skyAt, subpointsAt, type SubpointTable } from "../src/science/sky";

const table = JSON.parse(readFileSync("public/data/ephemeris/moon_subpoints_hourly.json", "utf8")) as SubpointTable;
const fixtures = JSON.parse(readFileSync("public/data/validation/horizons_topocentric.json", "utf8")) as {
  cases: { site: string; lon: number; lat: number; body: "sun" | "earth"; t: number; az: number; el: number }[];
};

describe("angle helpers", () => {
  it("interpolates azimuth the short way across 0/360", () => {
    expect(lerpAngleDeg(359, 1, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngleDeg(1, 359, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngleDeg(350, 10, 0.25)).toBeCloseTo(355, 9);
  });
  it("measures sky separation correctly for tiny and large angles", () => {
    expect(angularSeparationDeg({ az: 10, el: 5 }, { az: 10, el: 5.001 })).toBeCloseTo(0.001, 6);
    expect(angularSeparationDeg({ az: 0, el: 0 }, { az: 180, el: 0 })).toBeCloseTo(180, 6);
    // Near the zenith a big azimuth difference is a small angle on the sky.
    expect(angularSeparationDeg({ az: 0, el: 89.99 }, { az: 180, el: 89.99 })).toBeCloseTo(0.02, 4);
  });
});

describe("Horizons sub-point table", () => {
  it("is hourly, gap-free and spans Aug 2023 to the end of 2028", () => {
    expect(table.step_s).toBe(3600);
    expect(table.n).toBe(table.sunLon.length);
    expect(new Date(table.start_unix * 1000).toISOString()).toBe("2023-08-01T00:00:00.000Z");
    expect(new Date((table.start_unix + (table.n - 1) * 3600) * 1000).toISOString()).toBe("2029-01-01T00:00:00.000Z");
  });
  it("refuses instants outside the table instead of extrapolating", () => {
    expect(subpointsAt(table, table.start_unix - 1)).toBeNull();
  });
});

describe("sky engine vs Horizons' own topocentric ephemeris (observer on the Moon)", () => {
  const errors = fixtures.cases.map((c) => {
    const sky = skyAt(table, c.t, c.lon, c.lat);
    if (!sky) throw new Error(`no sky for ${c.site} at ${c.t}`);
    const mine = c.body === "sun" ? sky.sun : sky.earth;
    return { ...c, err: angularSeparationDeg(mine, { az: c.az, el: c.el }), dEl: mine.el - c.el };
  });

  it("covers 5 sites x 2 bodies x 2 windows, sampled half-way between table rows", () => {
    expect(new Set(errors.map((e) => e.site)).size).toBe(5);
    expect(errors.every((e) => new Date(e.t * 1000).getUTCMinutes() === 30)).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(150);
  });

  it("agrees within 0.01 deg everywhere (sky separation and elevation)", () => {
    const worst = errors.reduce((a, b) => (b.err > a.err ? b : a));
    const worstEl = Math.max(...errors.map((e) => Math.abs(e.dEl)));
    console.log(`sky check: ${errors.length} cases, max separation ${worst.err.toFixed(5)} deg (${worst.site}, ${worst.body}), max |dEl| ${worstEl.toFixed(5)} deg`);
    expect(worst.err).toBeLessThan(0.01);
    expect(worstEl).toBeLessThan(0.01);
  });
});
