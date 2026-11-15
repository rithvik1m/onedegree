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
  try {
    c.scanner.hide();
    c.planner.hide();
    c.instrument.close();
    document.getElementById("intro")?.classList.add("hidden");
    // 1. the outpost
    const gy0 = w.groundAt(0, 0);
    const fly = w.cinematic(5200, (u, cam) => {
      const a = -0.9 + u * 1.1;
      cam.position.set(Math.sin(a) * 110, gy0 + 26 - u * 8, -Math.cos(a) * 110);
      cam.lookAt(-4, gy0 + 2, 2);
    }, false);
    c.caption("A research outpost at the lunar south pole (fictional) — on a site chosen by code from NASA's sunlight maps.", 5200);
    await fly;

    // 2. solar station: Sun path over 30 days
    const it = w.outpost?.interactables.find((i) => i.id === "solar");
    if (it) w.player.place(it.x, it.z + 2.5, Math.PI);
    w.player.pitch = 0.02;
    store.set({ time: store.s.time });
    c.interact("solar");
    const look = w.cinematic(6200, (u, cam) => {
      const gy = w.groundAt(it?.x ?? 0, it?.z ?? 0);
      cam.position.set((it?.x ?? 0) - 6, gy + 3.2, (it?.z ?? 0) + 7);
      const s = w.sky.sunDir;
      const tgt = new THREE.Vector3(cam.position.x + s.x * 50, cam.position.y + 2 + s.y * 50, cam.position.z + s.z * 50);
      cam.lookAt(tgt.x * 0.35 + (it?.x ?? 0) * 0.65, gy + 1.6 + u * 0.4, tgt.z * 0.35 + (it?.z ?? 0) * 0.65);
    }, true);
    c.caption("Solar station: NASA/JPL Horizons puts the Sun in the sky; NASA LOLA terrain decides if it clears the horizon. Amber = sunlit, red = blocked.", 6200);
    await look;
    c.instrument.close();

    // 3. survey point S-1, 433 m away
    const sv = w.outpost?.interactables.find((i) => i.id === "survey");
    const mom = findBlockedMoment(c.data, c.survey, c.windowT0);
    if (sv) w.player.place(sv.x + 2, sv.z + 2, 0);
    if (mom) store.set({ time: mom.t });
    c.instrument.skylineOn = true;
    c.interact("survey");
    const a = analyse(c.data, c.survey, c.windowT0, 30);
    const s1 = w.cinematic(8200, (u, cam) => {
      const gy = w.groundAt(sv?.x ?? 0, sv?.z ?? 0);
      cam.position.set((sv?.x ?? 0) + 3, gy + 1.8, (sv?.z ?? 0) + 3);
      if (mom) {
        const d = new THREE.Vector3(Math.cos(mom.sunEl * Math.PI / 180) * Math.sin(mom.az * Math.PI / 180), Math.sin((mom.sunEl + 1.5) * Math.PI / 180), -Math.cos(mom.sunEl * Math.PI / 180) * Math.cos(mom.az * Math.PI / 180));
        cam.lookAt(cam.position.x + d.x, cam.position.y + d.y, cam.position.z + d.z);
      }
      void u;
    }, false);
    if (mom) c.caption(`433 m down the slope: a smooth Moon puts the Sun ${mom.sunEl.toFixed(1)}° up. The real ridge is ${mom.ridge.toFixed(1)}°. One degree decides.`, 8200);
    else if (a) c.caption(`Survey point S-1: sunlit ${a.mReal.sunlitPct.toFixed(0)}% of the next 30 days (smooth Moon: ${a.mSmooth.sunlitPct.toFixed(0)}%).`, 8200);
    await s1;
    c.instrument.close();
    c.instrument.skylineOn = false;
    w.sky.setSkyline(null);

    // 4. mission control: compare + slip
    c.interact("control");
    c.caption("Mission control: compare candidate sites and test a launch slip — same engine, same NASA data.", 3600);
    await wait(3600);
    store.set({ slipDays: 7 });
    c.caption("A one-week slip changes the lighting. Every polar plan must be re-checked for its launch date.", 3400);
    await wait(3400);
    c.planner.hide();
    document.body.classList.remove("console");
    store.set({ slipDays: 0 });
    c.caption("ONE DEGREE — real NASA data, a fictional outpost. On the Moon, one degree decides everything.", 4000);
    await wait(4000);
  } finally {
    document.body.classList.remove("demo");
    running = false;
  }
}
