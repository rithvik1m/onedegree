/**
 * The 30-second guided demo: a fixed, repeatable sequence of the real app, with
 * caption-only title cards. Every number on screen is computed live.
 */

import type { Data, Place } from "./data";
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

export async function runDemo(c: Ctx): Promise<void> {
  if (running) return;
  running = true;
  document.body.classList.add("demo");
  try {
    const sites = c.data.sites.sites;
    const athena = sites.find((s) => s.id === "im2") as Place;
    const odysseus = sites.find((s) => s.id === "im1") as Place;
    const t0 = Date.parse("2025-03-06T00:00:00Z") / 1000;
    c.planner.hide();
    c.scanner.hide();
    c.store.set({ here: athena, time: t0 + 12 * 3600, terrain: "real", mode: "surface" });
    if (c.moon) {
      c.moon.startWalk(athena.lon, athena.lat, 0);
      const sky = c.moon && c.data ? null : null;
      void sky;
    }
    c.caption("What if you could stand on a landing site — and test it?", 3800);
    await wait(4000);

    c.scanner.show();
    c.caption("NASA/JPL Horizons tracks the Sun and Earth from this exact spot.", 3800);
    await wait(4000);

    c.caption("On a smooth Moon, the Sun would be up…", 2000);
    c.store.set({ terrain: "smooth" });
    await wait(2000);
    c.store.set({ terrain: "real" });
    c.caption("…real LRO laser-altimeter terrain says otherwise. One degree decides.", 3000);
    await wait(3200);

    c.scanner.hide();
    c.store.set({ a: athena, b: odysseus, landing: t0, slipDays: 0, windowDays: 30, plannerIndex: 0 });
    c.planner.show("compare");
    c.caption("Compare two real landing sites over a whole lunar day.", 3200);
    await wait(3600);

    for (let d = 1; d <= 7; d++) {
      c.store.set({ slipDays: d });
      await wait(260);
    }
    c.caption("Launch slips a week? See what changes — in seconds.", 3600);
    await wait(4000);

    c.planner.show("reality");
    c.caption("Every claim re-checked live against NASA's own numbers.", 3600);
    await wait(3800);

    c.planner.hide();
    c.caption("ONE DEGREE — explore the Moon, understand the horizon.", 3500);
    await wait(3500);
  } finally {
    document.body.classList.remove("demo");
    running = false;
  }
}
