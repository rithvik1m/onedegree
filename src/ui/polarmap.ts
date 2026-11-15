// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * 2D south-pole map for the planner: LOLA relief + NASA's long-term sunlight map,
 * in the same polar stereographic frame as the terrain engine. Clicking places
 * Site A or B; the planner then computes that point's skyline live.
 */

import type { Place } from "../data";
import { fromPolarXY, toPolarXY } from "../science/terrain";
import type { State, Store } from "../state";
import { $, fmtLat, fmtLon } from "./format";

const HALF = 304_000;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(src));
    i.src = src;
  });
}

export class PolarMap {
  private relief: HTMLImageElement | null = null;
  private sun: HTMLImageElement | null = null;
  private target: "a" | "b" = "a";
  private canvas = $("polarMap") as HTMLCanvasElement;

  constructor(private store: Store, private places: () => Place[]) {
    void Promise.all([load("/data/terrain/polar_relief.png"), load("/data/terrain/polar_sunlight.png")])
      .then(([r, s]) => {
        this.relief = r;
        this.sun = s;
        this.draw(this.store.s);
      })
      .catch(() => {
        /* map is optional; the rest of the planner works without it */
      });
    for (const b of $("mapTarget").querySelectorAll<HTMLButtonElement>("button")) {
      b.addEventListener("click", () => {
        this.target = b.dataset.v as "a" | "b";
        for (const x of $("mapTarget").querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
      });
    }
    $("mapSun").addEventListener("change", () => this.draw(this.store.s));
    this.canvas.addEventListener("click", (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 2 * HALF - HALF;
      const y = HALF - ((ev.clientY - r.top) / r.height) * 2 * HALF;
      const [lon, lat] = fromPolarXY(x, y);
      if (lat > -80) return;
      const p: Place = { name: `Map point ${fmtLat(lat)}, ${fmtLon(lon)}`, short: `${fmtLat(lat)} ${fmtLon(lon)}`, lat, lon, kind: "custom" };
      this.store.set(this.target === "a" ? { a: p } : { b: p });
    });
  }

  draw(s: State): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(260, Math.round(c.clientWidth || 520));
    if (c.width !== W * dpr) {
      c.width = W * dpr;
      c.height = W * dpr;
    }
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#050506";
    g.fillRect(0, 0, W, W);
    if (this.relief) g.drawImage(this.relief, 0, 0, W, W);
    if (this.sun && ($("mapSun") as HTMLInputElement).checked) g.drawImage(this.sun, 0, 0, W, W);
    const P = (lon: number, lat: number): [number, number] => {
      const [x, y] = toPolarXY(lon, lat);
      return [((x + HALF) / (2 * HALF)) * W, ((HALF - y) / (2 * HALF)) * W];
    };
    // Latitude rings and the pole
    g.strokeStyle = "rgba(236,230,218,0.35)";
    g.setLineDash([3, 4]);
    for (const lat of [-85, -88]) {
      const [, y] = P(0, lat);
      const r = W / 2 - y;
      g.beginPath();
      g.arc(W / 2, W / 2, Math.abs(r), 0, Math.PI * 2);
      g.stroke();
    }
    g.setLineDash([]);
    g.font = "600 10px Inter, sans-serif";
    g.fillStyle = "rgba(236,230,218,0.75)";
    g.textAlign = "center";
    g.fillText("0°E", W / 2, 12);
    g.fillText("180°", W / 2, W - 5);
    g.textAlign = "left";
    g.fillText("90°E", W - 30, W / 2 - 4);
    g.fillText("270°E", 4, W / 2 - 4);
    g.fillStyle = "#ece6da";
    g.beginPath();
    g.arc(W / 2, W / 2, 2.5, 0, Math.PI * 2);
    g.fill();
    // Named sites
    for (const p of this.places()) {
      if (p.lat > -80) continue;
      const [x, y] = P(p.lon, p.lat);
      g.fillStyle = "#ece6da";
      g.strokeStyle = "#000";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(236,230,218,0.9)";
      g.font = "600 10.5px Inter, sans-serif";
      g.fillText(p.short, x + 6, y - 5);
    }
    // A and B
    const mark = (p: Place, label: string, color: string): void => {
      if (p.lat > -80) return;
      const [x, y] = P(p.lon, p.lat);
      g.strokeStyle = "#000";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.stroke();
      g.font = "800 13px Inter, sans-serif";
      g.lineWidth = 3;
      g.strokeStyle = "#000";
      g.strokeText(label, x + 11, y + 15);
      g.fillStyle = color;
      g.fillText(label, x + 11, y + 15);
    };
    mark(s.a, "A", "#f2b544");
    mark(s.b, "B", "#b9dcff");
  }
}
