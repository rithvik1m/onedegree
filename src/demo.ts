// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The 30-second guided demo: a fixed, repeatable tour of the real app with
 * caption-only title cards. Every number on screen is computed live; the "one
 * degree" moment is found in the real data (a time when a smooth Moon says the Sun
 * is up but LOLA terrain hides it), never staged.
 */

import * as THREE from "three";
import { analyse, STEP_S, type Data, type Place } from "./data";
import type { Store } from "./state";
import type { Planner, Scanner } from "./ui/panels";
import type { Instrument } from "./ui/instrument";
import type { Campaign } from "./game/missions";
import type { SurfaceWorld } from "./surface/world";

interface Ctx {
  store: Store;
  scanner: Scanner;
  planner: Planner;
  world: SurfaceWorld;
  instrument: Instrument;
  campaign: Campaign;
  data: Data;
  windowT0: number;
  outpost: Place;
  survey: Place;
  interact: (id: string) => void;
  caption: (t: string, ms?: number) => void;
  openCompare?: () => void;
}

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
let running = false;

/** The clearest "one degree" moment in a window: the Sun well above a smooth
 *  horizon AND fully hidden by the real LOLA skyline (maximises the smaller margin). */
export function findBlockedMoment(data: Data, p: Place, t0: number): { t: number; sunEl: number; ridge: number; az: number } | null {
  const a = analyse(data, p, t0, 30);
  if (!a || !a.skyline) return null;
  let best: { t: number; sunEl: number; ridge: number; az: number; score: number } | null = null;
  for (let i = 0; i < a.track.n; i++) {
    const el = a.track.sunEl[i] as number;
    const hz = a.real.sunHorizon[i] as number;
    const score = Math.min(el - a.smoothDeg - 0.27, hz - el - 0.27);
    if (score > 0 && (!best || score > best.score)) best = { t: a.t0 + i * STEP_S, sunEl: el, ridge: hz, az: a.track.sunAz[i] as number, score };
  }
  return best;
}

export async function runDemo(c: Ctx): Promise<void> {
  if (running) return;
  running = true;
  document.body.classList.add("demo");
  const w = c.world;
  const { store } = c;
  const clock = store.s.time;
  try {
    c.scanner.hide();
    c.planner.hide();
    c.instrument.close();
    document.getElementById("intro")?.classList.add("hidden");
    // 0–4 s · the outpost
    const gy0 = w.groundAt(0, 0);
    const fly = w.cinematic(4000, (u, cam) => {
      const a = -0.9 + u * 0.8;
      cam.position.set(Math.sin(a) * 100, gy0 + 22 - u * 6, -Math.cos(a) * 100);
      cam.lookAt(-4, gy0 + 2, 2);
    }, false);
    c.caption("On the Moon, one degree decides everything.", 4000);
    await fly;

    // 4–8 s · the astronaut walks to the solar station (real movement, third person)
    const it = w.outpost?.interactables.find((i) => i.id === "solar");
    const sx = it?.x ?? 0, sz = it?.z ?? 0;
    w.player.thirdPerson = true;
    w.player.place(sx + 3, sz + 13, Math.atan2(-3, 13) + Math.PI);
    w.player.pitch = -0.12;
    w.player.keys.add("KeyW");
    c.caption("Explore the lunar south pole.", 3800);
    await wait(3600);
    w.player.keys.delete("KeyW");
    await wait(300);

    // 8–13 s · measure: plain-language answers from NASA data
    c.instrument.setLevel("simple");
    c.interact("solar");
    c.caption("Discover how terrain changes sunlight.", 5000);
    await wait(5000);
    c.instrument.close();

    // 13–17.5 s · drive the rover toward S-1
    const sv = w.outpost?.interactables.find((i) => i.id === "survey");
    if (w.rover && sv) {
      const pt = (x: number, z: number): number => w.groundAt(x, z);
      const bay = w.outpost?.roverBay ?? { x: 24, z: 28 };
      const brg = Math.atan2(sv.x - bay.x, -(sv.z - bay.z));
      w.rover.place(bay.x + Math.sin(brg) * 45, bay.z - Math.cos(brg) * 45, brg, pt);
      w.rover.headlights = true;
      w.enterRover();
      w.player.keys.add("KeyW");
      c.caption("Investigate another location.", 4500);
      await wait(4500);
      w.player.keys.delete("KeyW");
      w.exitRover();
      w.rover.headlights = false;
    }

    // 17.5–21.5 s · S-1: the ridge that hides the Sun (the real "one degree" moment in the data)
    const mom = findBlockedMoment(c.data, c.survey, c.windowT0);
    // stand at S-1 so the sunlight in the scene is computed for S-1's own horizon
    if (sv) w.player.place(sv.x + 2, sv.z + 2, ((mom?.az ?? 0) * Math.PI) / 180);
    w.player.thirdPerson = false;
    if (mom) store.set({ time: mom.t });
    const B = analyse(c.data, c.survey, c.windowT0, 30);
    if (B?.skyline) w.sky.setSkyline(B.skyline.horizon);
    if (B) w.sky.setPath(Array.from({ length: B.track.n }, (_, k) => ({ az: B.track.sunAz[k] as number, el: B.track.sunEl[k] as number, visible: B.real.sunLit[k] === 1 })), 0xf2b544);
    const s1 = w.cinematic(4000, (u, cam) => {
      const gy = w.groundAt(sv?.x ?? 0, sv?.z ?? 0);
      const az = ((mom?.az ?? 0) * Math.PI) / 180;
      const dx = Math.sin(az), dz = -Math.cos(az);
      const px = (sv?.x ?? 0) - dx * 6 + dz * 2, pz = (sv?.z ?? 0) - dz * 6 - dx * 2;
      cam.position.set(px, gy + 1.8 + u * 0.2, pz);
      const el = (((mom?.ridge ?? 3) * 0.6 + 0.5) * Math.PI) / 180;
      cam.lookAt(px + dx * 100, gy + 1.8 + Math.tan(el) * 100, pz + dz * 100);
    }, false);
    if (mom && B) c.caption(`433 m away, a ridge hides the Sun (${mom.ridge.toFixed(1)}° vs ${mom.sunEl.toFixed(1)}°): sunlit ${B.mReal.sunlitPct.toFixed(0)}% of the month, not 100%.`, 4000);
    await s1;
    w.sky.setSkyline(null);
    w.sky.setPath(null, 0);

    // 21.5–25.5 s · field computer: compare real conditions
    if (c.openCompare) {
      c.openCompare();
      c.caption("Compare real landing conditions.", 4000);
      await wait(4000);
      (document.getElementById("compare") as HTMLDialogElement | null)?.close();
    }

    // 25.5–29.5 s · end card
    store.set({ time: clock });
    const sp0 = w.outpost?.spawn;
    if (sp0) w.player.place(sp0.x, sp0.z, sp0.yaw);
    w.player.thirdPerson = false;
    store.set({ here: c.outpost });
    const endShot = w.cinematic(3800, (u, cam) => {
      const ang = -0.55 + u * 0.3;
      cam.position.set(Math.sin(ang) * 125, gy0 + 30 - u * 6, -Math.cos(ang) * 125);
      cam.lookAt(-4, gy0 + 1, 2);
    }, false);
    c.caption("ONE DEGREE — Explore. Measure. Understand. Plan.", 3800);
    await endShot;
    const sp = w.outpost?.spawn;
    if (sp) w.player.place(sp.x, sp.z, sp.yaw);
  } finally {
    document.body.classList.remove("demo");
    running = false;
  }
}
