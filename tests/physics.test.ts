// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/** Physics prototype (Rapier) — behaviour that must hold before it can replace anything. */
import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { DEFAULT_ROVER, G_MOON, PhysicsManager, driveVehicle, initPhysics } from "../src/physics/manager";

beforeAll(async () => {
  await initPhysics();
});

function dropTime(pm: PhysicsManager, mass: number, h: number, frameDt: number): number {
  pm.addTerrain(() => 0, 0, 0, 20, 2);
  const r = 0.2;
  const b = pm.addBall(0, h + r, 0, r, mass);
  let t = 0;
  while (t < 20) {
    pm.step(frameDt);
    t += frameDt;
    if (b.translation().y <= r + 0.01) break;
  }
  return t;
}

describe("Rapier physics prototype", () => {
  it("free fall: 1 kg and 100 kg land together after sqrt(2h/g) (lunar g)", () => {
    const h = 10, expect_t = Math.sqrt((2 * h) / G_MOON);
    const t1 = dropTime(new PhysicsManager(), 1, h, 1 / 60);
    const t100 = dropTime(new PhysicsManager(), 100, h, 1 / 60);
    console.log(`drop 10 m: theory ${expect_t.toFixed(3)} s · 1 kg ${t1.toFixed(3)} s · 100 kg ${t100.toFixed(3)} s`);
    expect(Math.abs(t1 - expect_t)).toBeLessThan(0.05);
    expect(Math.abs(t1 - t100)).toBeLessThan(1 / 60 + 1e-9);
  });

  it("radial gravity matches uniform gravity locally", () => {
    const tu = dropTime(new PhysicsManager(), 5, 10, 1 / 60);
    const tr = dropTime(new PhysicsManager({ radial: true }), 5, 10, 1 / 60);
    expect(Math.abs(tu - tr)).toBeLessThan(1 / 60 + 1e-9);
  });

  it("is frame-rate independent (fixed step + accumulator): 30 fps vs 144 fps", () => {
    const a = dropTime(new PhysicsManager(), 10, 10, 1 / 30);
    const b = dropTime(new PhysicsManager(), 10, 10, 1 / 144);
    console.log(`frame-rate independence: 30 fps ${a.toFixed(3)} s · 144 fps ${b.toFixed(3)} s`);
    expect(Math.abs(a - b)).toBeLessThan(1 / 30 + 1e-9);
  });

  it("rover settles on its suspension with all wheels in contact, and drives", () => {
    const pm = new PhysicsManager();
    pm.addTerrain(() => 0, 0, 0, 60, 2);
    const v = pm.addVehicle(0, 2.0, 0);
    for (let i = 0; i < 240; i++) pm.step(1 / 60, (h) => { driveVehicle(v, 0, 0, 0.2, "explorer"); v.vc.updateVehicle(h); });
    const contacts = [0, 1, 2, 3].filter((i) => v.vc.wheelIsInContact(i)).length;
    const vy = v.chassis.linvel().y;
    const susp = [0, 1, 2, 3].map((i) => v.vc.wheelSuspensionLength(i) ?? NaN);
    console.log(`rover at rest: contacts ${contacts}/4, suspension ${susp.map((s) => s.toFixed(3)).join(" ")} m (rest ${DEFAULT_ROVER.suspensionRest}), vy ${vy.toFixed(4)}`);
    expect(contacts).toBe(4);
    expect(Math.abs(vy)).toBeLessThan(0.05);
    for (const s of susp) expect(s).toBeLessThan(DEFAULT_ROVER.suspensionRest);
    // drive forward for 4 s
    const z0 = v.chassis.translation().z;
    for (let i = 0; i < 240; i++) pm.step(1 / 60, (h) => { driveVehicle(v, 0, 1, 0, "explorer"); v.vc.updateVehicle(h); });
    const moved = Math.abs(v.chassis.translation().z - z0);
    console.log(`rover drove ${moved.toFixed(1)} m in 4 s, speed ${v.vc.currentVehicleSpeed().toFixed(2)} m/s`);
    expect(moved).toBeGreaterThan(3);
  });

  it("character controller walks up 20° but not 45°", () => {
    for (const [deg, canClimb] of [[20, true], [45, false]] as [number, boolean][]) {
      const pm = new PhysicsManager();
      const k = Math.tan((deg * Math.PI) / 180);
      pm.addTerrain((x) => (x > 2 ? (x - 2) * k : 0), 10, 0, 40, 0.5);
      const c = pm.addCharacter(0, 0, 0);
      for (let i = 0; i < 300; i++) {
        pm.step(1 / 60, (h) => {
          const want = { x: 2.5 * h, y: -G_MOON * h, z: 0 };
          c.ctl.computeColliderMovement(c.collider, want);
          const m = c.ctl.computedMovement();
          const p = c.body.translation();
          c.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
        });
      }
      const x = c.body.translation().x;
      console.log(`slope ${deg}°: reached x = ${x.toFixed(2)} m`);
      if (canClimb) expect(x).toBeGreaterThan(6);
      else expect(x).toBeLessThan(3.5);
    }
  });
});
void RAPIER;

describe("terrain collider agrees with the rendered surface", () => {
  it("balls dropped on the heightfield come to rest at ground(x, z) + radius", () => {
    const pm = new PhysicsManager();
    const ground = (x: number, z: number): number => 0.04 * x - 0.03 * z + 2;
    pm.addTerrain(ground, 0, 0, 40, 1);
    const pts: [number, number][] = [[5, 3], [-7, 9], [12, -4]];
    const balls = pts.map(([x, z]) => pm.addBall(x, ground(x, z) + 3, z, 0.25, 20));
    for (let i = 0; i < 600; i++) pm.step(1 / 60);
    balls.forEach((b, k) => {
      const [x0, z0] = pts[k] as [number, number];
      const p = b.translation();
      const err = p.y - 0.25 - ground(p.x, p.z);
      console.log(`ball ${k} from (${x0},${z0}) rests ${err.toFixed(3)} m from the surface`);
      expect(Math.abs(err)).toBeLessThan(0.03);
    });
  });
});
