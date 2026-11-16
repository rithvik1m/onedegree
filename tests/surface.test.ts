// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Regression tests for the 3D surface layer: the world the player walks in must
 * agree with the science engine (location, horizon, time) and obey lunar physics.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { farHorizon, groundY, lonLatToScene, parsePatch, ringRadii, sceneToLonLat, type PatchMeta } from "../src/surface/terrain3d";
import * as THREE from "three";
import { Player, G_MOON } from "../src/surface/player";
import { Rover } from "../src/surface/rover";
import { skyAt, skyTrack, type SubpointTable } from "../src/science/sky";

const meta = JSON.parse(readFileSync("public/data/surface/outpost.json", "utf8")) as PatchMeta;
const bin = readFileSync("public/data/surface/outpost.bin");
const patch = parsePatch("outpost", meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const profile = JSON.parse(readFileSync("public/data/horizons/outpost.json", "utf8")) as { horizon_deg: number[]; ground_m: number; eye_m: number };

describe("surface patch (NASA LOLA polar mesh)", () => {
  it("uses the same ring layout as scripts/outpost.py", () => {
    const r = ringRadii();
    expect(r.length).toBe(meta.n_rings);
    for (let i = 0; i < r.length; i += 37) expect(r[i]).toBeCloseTo(meta.radii_m[i] as number, 1);
  });

  it("puts the site itself at the scene origin, on the ground", () => {
    expect(groundY(patch, 0, 0)).toBeCloseTo(0, 6);
    expect(patch.groundM).toBeCloseTo(profile.ground_m, 0);
  });

  it("keeps location continuity: lon/lat -> scene -> lon/lat round-trips to < 1 mm", () => {
    for (const [dx, dz] of [[0, 0], [120, -415], [-40, 8], [990, 990], [-1500, 300]] as [number, number][]) {
      const [lon, lat] = sceneToLonLat(patch, dx, dz);
      const [x, z] = lonLatToScene(patch, lon, lat);
      expect(Math.hypot(x - dx, z - dz)).toBeLessThan(1e-3);
    }
  });

  it("the 3D terrain's own horizon matches the scanner's LOLA skyline", () => {
    const out = new Float32Array(720);
    farHorizon(patch, 0, 0, profile.eye_m, 10, out);
    let sum = 0, max = 0;
    for (let j = 0; j < 720; j++) {
      const d = Math.abs((out[j] as number) - (profile.horizon_deg[j] as number));
      sum += d;
      max = Math.max(max, d);
    }
    const mean = sum / 720;
    console.log(`3D mesh horizon vs LOLA skyline (outpost): mean |Δ| ${mean.toFixed(3)}°, max ${max.toFixed(3)}°`);
    // Measured when written: mean 0.019°, max 0.153° (the mesh resamples the same DEMs).
    expect(mean).toBeLessThan(0.05);
    expect(max).toBeLessThan(0.3);
  });
});

describe("on-foot physics", () => {
  it("jumps like the Moon: apex v²/2g and air time 2v/g with g = 1.62 m/s²", () => {
    const p = new Player(() => 0);
    p.place(0, 0, 0);
    p.jump();
    const v0 = p.vel.y;
    let t = 0, apex = 0;
    const dt = 1 / 240;
    do {
      p.update(dt, t * 1000);
      t += dt;
      apex = Math.max(apex, p.pos.y);
    } while (!p.onGround && t < 10);
    expect(apex).toBeCloseTo((v0 * v0) / (2 * G_MOON), 1);
    expect(t).toBeCloseTo((2 * v0) / G_MOON, 1);
  });

  it("cannot walk up a wall steeper than ~30°", () => {
    const p = new Player((x) => (x > 1 ? (x - 1) * 1.2 : 0)); // 50° slope east of x = 1
    p.place(0, 0, Math.PI / 2); // facing east
    p.keys.add("KeyW");
    for (let i = 0; i < 600; i++) p.update(1 / 60, i * 16);
    expect(p.pos.x).toBeLessThan(1.6);
  });
});

describe("time: the 3D sky and the instruments read the same instant", () => {
  it("skyTrack sample i equals skyAt(t0 + i·step)", () => {
    const table = JSON.parse(readFileSync("public/data/ephemeris/moon_subpoints_hourly.json", "utf8")) as SubpointTable;
    const t0 = Date.UTC(2026, 10, 15) / 1000;
    const tr = skyTrack(table, t0, 48, 1800, meta.lon, meta.lat, 0);
    for (const i of [0, 7, 33, 96]) {
      const s = skyAt(table, t0 + i * 1800, meta.lon, meta.lat, 0);
      expect(s).not.toBeNull();
      expect(tr.sunEl[i]).toBeCloseTo(s!.sun.el, 4);
      expect(tr.earthAz[i]).toBeCloseTo(s!.earth.az, 3);
    }
  });
});

describe("rover (gameplay vehicle on real terrain)", () => {
  const fakeGltf = () => ({ scene: new THREE.Group(), animations: [] }) as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF;
  const run = (r: Rover, keys: string[], ground: (x: number, z: number) => number, secs: number, colliders: { x: number; z: number; r: number }[] = []): void => {
    const k = new Set(keys);
    for (let t = 0; t < secs; t += 1 / 60) r.update(1 / 60, k, ground, colliders, true);
  };

  it("drives, tops out at its game speed, and stays on the ground", () => {
    const r = new Rover(fakeGltf());
    const ground = (x: number, z: number): number => 0.02 * x + 0.01 * z; // gentle tilt
    r.place(0, 0, 0, ground);
    run(r, ["KeyW"], ground, 6);
    expect(r.speed).toBeGreaterThan(7.5);
    expect(r.speed).toBeLessThanOrEqual(8);
    expect(Math.abs(r.pos.y - ground(r.pos.x, r.pos.z))).toBeLessThan(0.05);
  });

  it("cannot climb a slope steeper than ~28°", () => {
    const r = new Rover(fakeGltf());
    const wall = (_x: number, z: number): number => (z < -20 ? (-20 - z) * 0.8 : 0); // 39° rise to the north
    r.place(0, 0, 0, wall);
    run(r, ["KeyW"], wall, 12);
    expect(r.pos.z).toBeGreaterThan(-24);
  });

  it("is stopped by structures", () => {
    const r = new Rover(fakeGltf());
    const flat = (): number => 0;
    r.place(0, 0, 0, flat);
    run(r, ["KeyW"], flat, 8, [{ x: 0, z: -30, r: 4 }]);
    expect(r.pos.z).toBeGreaterThan(-30 + 4 + 2.0);
  });
});
