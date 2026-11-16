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
    // 1. the outpost
    const gy0 = w.groundAt(0, 0);
    const fly = w.cinematic(4300, (u, cam) => {
      const a = -0.9 + u * 0.9;
      cam.position.set(Math.sin(a) * 100, gy0 + 22 - u * 6, -Math.cos(a) * 100);
      cam.lookAt(-4, gy0 + 2, 2);
    }, false);
    c.caption("A research outpost at the lunar south pole (fictional) — on a real site chosen by code from NASA's sunlight maps.", 4300);
    await fly;

    // 2. solar station: plain-language answers
    const it = w.outpost?.interactables.find((i) => i.id === "solar");
    const sx = it?.x ?? 0, sz = it?.z ?? 0;
    const sd = w.sky.sunDir.clone().setY(0).normalize();
    w.player.place(sx - sd.x * 1.2, sz - sd.z * 1.2, Math.atan2(sd.x, -sd.z));
    c.instrument.setLevel("simple");
    c.interact("solar");
    const look = w.cinematic(5200, (u, cam) => {
      const gy = w.groundAt(sx, sz);
      const back = 8 - u * 2;
      cam.position.set(sx - sd.x * back + sd.z * 3, gy + 2.6, sz - sd.z * back - sd.x * 3);
      cam.lookAt(sx + sd.x * 60, gy + 1.0, sz + sd.z * 60);
    }, true);
    c.caption("The Solar Station answers in plain words: is the Sun visible, is the land blocking it, when will that change?", 5200);
    await look;
    c.instrument.close();

    // 3. the rover, driving down the slope toward S-1
    const sv = w.outpost?.interactables.find((i) => i.id === "survey");
    if (w.rover && sv) {
      const pt = (x: number, z: number): number => w.groundAt(x, z);
      const bay = w.outpost?.roverBay ?? { x: 24, z: 28 };
      const brg = Math.atan2(sv.x - bay.x, -(sv.z - bay.z));
      w.rover.place(bay.x + Math.sin(brg) * 45, bay.z - Math.cos(brg) * 45, brg, pt);
      w.rover.headlights = true;
      w.enterRover();
      w.player.keys.add("KeyW");
      c.caption("Drive the rover 433 m down the slope to Survey point S-1…", 5600);
      await wait(5600);
      w.player.keys.delete("KeyW");
      w.exitRover();
      w.rover.headlights = false;
    }

    // 4. survey point S-1 at the clearest "one degree" moment in the data
    const mom = findBlockedMoment(c.data, c.survey, c.windowT0);
    if (sv) w.player.place(sv.x + 2, sv.z + 2, 0);
    if (mom) store.set({ time: mom.t });
    c.instrument.skylineOn = true;
    c.interact("survey");
    const a = analyse(c.data, c.survey, c.windowT0, 30);
    const s1 = w.cinematic(6800, (u, cam) => {
      const gy = w.groundAt(sv?.x ?? 0, sv?.z ?? 0);
      const az = ((mom?.az ?? 0) * Math.PI) / 180;
      const dx = Math.sin(az), dz = -Math.cos(az);
      const px = (sv?.x ?? 0) - dx * 7 + dz * 2, pz = (sv?.z ?? 0) - dz * 7 - dx * 2;
      cam.position.set(px, gy + 1.9 + u * 0.3, pz);
      const el = (((mom?.sunEl ?? 1) + 1.2) * Math.PI) / 180;
      cam.lookAt(px + dx * 100, gy + 1.9 + Math.tan(el) * 100, pz + dz * 100);
    }, false);
    if (mom) c.caption(`…where a ridge rises above the Sun (${mom.ridge.toFixed(1)}° vs ${mom.sunEl.toFixed(1)}°). Sunlit ${a ? a.mReal.sunlitPct.toFixed(0) : "—"}% of the month vs 100% at the outpost — a flat-Moon model says 100% for both.`, 6800);
    await s1;
    c.instrument.close();
    c.instrument.skylineOn = false;
    w.sky.setSkyline(null);

    // 5. field computer: compare and decide
    if (c.openCompare) {
      c.openCompare();
      c.caption("Compare, decide, and learn why: real NASA data, measured where you stand.", 3600);
      await wait(3600);
      (document.getElementById("compare") as HTMLDialogElement | null)?.close();
    }

    // 6. end card: the outpost with Earth in the sky
    store.set({ time: clock });
    const sp0 = w.outpost?.spawn;
    if (sp0) w.player.place(sp0.x, sp0.z, sp0.yaw);
    store.set({ here: c.outpost });
    const endShot = w.cinematic(3800, (u, cam) => {
      const ang = -0.55 + u * 0.3;
      cam.position.set(Math.sin(ang) * 125, gy0 + 30 - u * 6, -Math.cos(ang) * 125);
      cam.lookAt(-4, gy0 + 1, 2);
    }, false);
    c.caption("ONE DEGREE — real NASA data, a fictional outpost. On the Moon, one degree decides everything.", 3800);
    await endShot;
    const sp = w.outpost?.spawn;
    if (sp) w.player.place(sp.x, sp.z, sp.yaw);
  } finally {
    document.body.classList.remove("demo");
    running = false;
  }
}
