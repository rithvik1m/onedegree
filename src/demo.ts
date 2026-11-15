// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The 30-second guided demo: a fixed, repeatable sequence of the real app with
 * caption-only title cards. Every number on screen is computed live; the "one
 * degree" moment is found in the real data (a time when a smooth Moon says the Sun
 * is up but LOLA terrain hides it), never staged.
 */

import { analyse, STEP_S, type Data, type Place } from "./data";
import type { MoonScene } from "./cesium/moon";
import type { Store } from "./state";
import type { Planner, Scanner } from "./ui/panels";

interface Ctx {
  store: Store;
  scanner: Scanner;
  planner: Planner;
  moon: MoonScene | null;
  data: Data;
  caption: (t: string, ms?: number) => void;
}

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
let running = false;
const D2R = Math.PI / 180;

/** The clearest "one degree" moment in a window: the Sun well above a smooth
 *  horizon AND fully hidden by the real LOLA skyline (maximises the smaller margin). */
export function findBlockedMoment(data: Data, p: Place, t0: number): { t: number; sunEl: number; ridge: number } | null {
  const a = analyse(data, p, t0, 30);
  if (!a || !a.skyline) return null;
  let best: { t: number; sunEl: number; ridge: number; score: number } | null = null;
  for (let i = 0; i < a.track.n; i++) {
    const el = a.track.sunEl[i] as number;
    const hz = a.real.sunHorizon[i] as number;
    const score = Math.min(el - a.smoothDeg - 0.27, hz - el - 0.27);
    if (score > 0 && (!best || score > best.score)) best = { t: a.t0 + i * STEP_S, sunEl: el, ridge: hz, score };
  }
  return best;
}

export async function runDemo(c: Ctx): Promise<void> {
  if (running) return;
  running = true;
  document.body.classList.add("demo");
  try {
    const sites = c.data.sites.sites;
    const athena = sites.find((s) => s.id === "im2") as Place;
    const odysseus = sites.find((s) => s.id === "im1") as Place;
    const t0 = Date.parse("2025-03-06T00:00:00Z") / 1000;
    const azAt = (p: Place, t: number): number => {
      const a = analyse(c.data, p, Math.floor(t / 86400) * 86400, 30);
      if (!a) return 0;
      return (a.track.sunAz[Math.round((t - a.t0) / STEP_S)] as number) * D2R;
    };
    c.planner.hide();
    c.scanner.hide();
    const moment = findBlockedMoment(c.data, odysseus, t0);
    const tShow = moment?.t ?? t0 + 12 * 3600;

    // 1 — Orbit over the south pole.
    c.store.set({ here: odysseus, time: tShow, terrain: "smooth" });
    if (c.moon) {
      c.store.set({ mode: "orbit" });
      void c.moon.toOrbit(odysseus.lon, odysseus.lat, false);
    }
    c.caption("The Moon's south pole — where the next landers are headed.", 3400);
    await wait(3600);

    // 2 — Stand where Odysseus landed; a smooth Moon says the Sun is up.
    if (c.moon) {
      c.moon.startWalk(odysseus.lon, odysseus.lat, azAt(odysseus, tShow));
      if (c.moon.thirdPerson) c.moon.toggleView();
      c.moon.look(azAt(odysseus, tShow), 0.03);
    }
    c.store.set({ mode: "surface" });
    c.scanner.show();
    c.caption(moment ? `Odysseus's landing site. On a smooth Moon the Sun is ${moment.sunEl.toFixed(1)}° up…` : "Odysseus's landing site, with NASA/JPL Horizons Sun and Earth.", 4000);
    await wait(4200);

    // 3 — Real terrain: the same Sun is behind a ridge.
    c.store.set({ terrain: "real" });
    c.caption(moment ? `…NASA laser-altimeter terrain hides it behind a ${moment.ridge.toFixed(1)}° ridge. One degree decides.` : "Real NASA laser-altimeter terrain changes the answer.", 4000);
    await wait(4200);

    // 4 — Compare two real sites, then slip the date a week.
    c.scanner.hide();
    c.store.set({ a: athena, b: odysseus, landing: t0, slipDays: 0, windowDays: 30, plannerIndex: 0, terrain: "real" });
    c.planner.show("compare");
    c.caption("Compare two real landing sites across a whole lunar day.", 2900);
    await wait(3000);
    for (let d = 1; d <= 7; d++) {
      c.store.set({ slipDays: d });
      await wait(190);
    }
    c.caption("Launch slips a week? See what it costs — in seconds.", 2900);
    await wait(3000);

    // 5 — Proof.
    c.planner.show("reality");
    c.caption("Every number re-checked live against NASA's own data.", 3000);
    await wait(3100);

    // 6 — End card over the Moon.
    c.planner.hide();
    if (c.moon) {
      c.store.set({ mode: "orbit" });
      void c.moon.toOrbit(athena.lon, athena.lat, false);
    }
    c.caption("ONE DEGREE — explore the Moon, understand the horizon.", 3300);
    await wait(3300);
  } finally {
    document.body.classList.remove("demo");
    running = false;
  }
}
