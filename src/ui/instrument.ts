// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Field instruments at the outpost (Solar station, Comms station, Survey scanner).
 * Every number comes from `analyse()` — the same Horizons × LOLA engine as the
 * scanner and planner — over the mission's 30-day window.
 */

import { analyse, type Analysis, type Data, type Place } from "../data";
import { nextChange } from "../science/visibility";
import type { State, Store } from "../state";
import { drawPanorama, drawStrip, stripIndexFromEvent } from "./charts";
import { $, compass, esc, fmtDate, fmtDeg, fmtHours, fmtUtc } from "./format";

export type InstKind = "solar" | "comms" | "survey";

const TITLES: Record<InstKind, [string, string]> = {
  solar: ["Solar Monitoring Station", "Sun sensor · NASA/JPL Horizons × LOLA horizon"],
  comms: ["Comms Station", "Direct-to-Earth line of sight · Horizons × LOLA"],
  survey: ["Survey Scanner · S-1", "Horizon survey · real terrain vs smooth Moon"],
};

export interface InstrumentHooks {
  onRecord: (kind: InstKind, result: string) => void;
  onPath: (kind: InstKind, a: Analysis | null) => void;
  onSkyline: (on: boolean, a: Analysis | null) => void;
}

function idxOf(a: Analysis, t: number): number {
  return Math.max(0, Math.min(a.track.n - 1, Math.round((t - a.t0) / a.track.stepS)));
}

function nextText(a: Analysis, flags: Uint8Array, i: number, on: string, off: string): string {
  const j = nextChange(flags, i);
  if (j < 0) return `No change in the rest of the ${a.days}-day window`;
  const dtH = ((j - i) * a.track.stepS) / 3600;
  return `${flags[i] ? off : on} in ${fmtHours(dtH)} · ${fmtUtc(a.t0 + j * a.track.stepS)} UTC`;
}

export class Instrument {
  kind: InstKind | null = null;
  private place: Place | null = null;
  private ref: Place | null = null;
  private timer = 0;
  pathOn = true;
  skylineOn = false;

  constructor(private data: Data, private store: Store, private t0: () => number, private hooks: InstrumentHooks) {
    $("instClose").addEventListener("click", () => this.close());
    $("instPlay").addEventListener("click", () => this.togglePlay());
    $("instBack").addEventListener("click", () => this.step(-24));
    $("instFwd").addEventListener("click", () => this.step(24));
    $("instNow").addEventListener("click", () => this.store.set({ time: this.t0() }));
    $("instPath").addEventListener("change", (e) => {
      this.pathOn = (e.target as HTMLInputElement).checked;
      this.hooks.onPath(this.kind as InstKind, this.pathOn ? this.analysis() : null);
    });
    $("instSky").addEventListener("change", (e) => {
      this.skylineOn = (e.target as HTMLInputElement).checked;
      this.hooks.onSkyline(this.skylineOn, this.analysis());
    });
    $("instRecord").addEventListener("click", () => {
      if (!this.kind) return;
      const r = this.resultText();
      this.hooks.onRecord(this.kind, r);
    });
    const strip = $("instStrip") as HTMLCanvasElement;
    const scrub = (ev: PointerEvent): void => {
      const a = this.analysis();
      if (!a) return;
      const i = stripIndexFromEvent(strip, ev, a.track.n);
      this.store.set({ time: a.t0 + i * a.track.stepS });
    };
    strip.addEventListener("pointerdown", (ev) => {
      scrub(ev);
      strip.setPointerCapture(ev.pointerId);
    });
    strip.addEventListener("pointermove", (ev) => {
      if (ev.buttons) scrub(ev);
    });
  }

  isOpen(): boolean {
    return this.kind !== null;
  }

  open(kind: InstKind, place: Place, ref: Place | null = null): void {
    this.kind = kind;
    this.place = place;
    this.ref = ref;
    const [t, sub] = TITLES[kind];
    $("instTitle").textContent = t;
    $("instSub").textContent = sub;
    $("inst").classList.remove("hidden");
    $("inst").dataset.kind = kind;
    ($("instPath") as HTMLInputElement).checked = this.pathOn;
    ($("instSky") as HTMLInputElement).checked = this.skylineOn;
    $("instPathLabel").textContent = kind === "comms" ? "Show Earth's path in the sky" : "Show the Sun's path in the sky";
    this.render(this.store.s);
    this.hooks.onPath(kind, this.pathOn ? this.analysis() : null);
    if (this.skylineOn) this.hooks.onSkyline(true, this.analysis());
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close(): void {
    this.stopPlay();
    if (this.kind) this.hooks.onPath(this.kind, null);
    this.kind = null;
    $("inst").classList.add("hidden");
  }

  analysis(): Analysis | null {
    return this.place ? analyse(this.data, this.place, this.t0(), 30) : null;
  }

  private step(hours: number): void {
    const a = this.analysis();
    if (!a) return;
    const end = a.t0 + (a.track.n - 1) * a.track.stepS;
    this.store.set({ time: Math.max(a.t0, Math.min(end, this.store.s.time + hours * 3600)) });
  }

  private togglePlay(): void {
    if (this.timer) return this.stopPlay();
    $("instPlay").textContent = "❚❚";
    this.timer = window.setInterval(() => {
      const a = this.analysis();
      if (!a) return this.stopPlay();
      const end = a.t0 + (a.track.n - 1) * a.track.stepS;
      const t = this.store.s.time + 4 * 3600 * 0.1;
      if (t > end) return this.stopPlay();
      this.store.set({ time: t });
    }, 100);
  }

  stopPlay(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    $("instPlay").textContent = "▶";
  }

  render(s: State): void {
    if (!this.kind || !this.place) return;
    const a = this.analysis();
    const body = $("instBody");
    if (!a) {
      body.innerHTML = `<p class="note">No ephemeris for this date.</p>`;
      return;
    }
    const i = idxOf(a, s.time);
    $("instTime").textContent = `${fmtUtc(a.t0 + i * a.track.stepS)} UTC`;
    const tr = a.track;
    let html = "";
    if (this.kind === "solar" || this.kind === "survey") {
      const el = tr.sunEl[i] as number, az = tr.sunAz[i] as number;
      const hz = a.real.sunHorizon[i] as number;
      const frac = a.real.sunFrac[i] as number;
      const lit = frac >= 0.5;
      const state = lit ? "Direct sunlight" : el > a.smoothDeg ? "Sun hidden by terrain" : "Sun below the horizon";
      const cls = lit ? "ok" : el > a.smoothDeg ? "warn" : "bad";
      html += `<div class="inst-state ${cls}"><span class="dot"></span>${state}<small>${(frac * 100).toFixed(0)}% of the disc visible</small></div>
      <div class="inst-grid">
        <div><label>Sun elevation</label><b>${fmtDeg(el)}</b></div>
        <div><label>Sun azimuth</label><b>${az.toFixed(1)}° <small>${compass(az)}</small></b></div>
        <div><label>Terrain horizon that way</label><b>${fmtDeg(hz)}</b></div>
        <div><label>Clearance</label><b class="${el - hz >= 0 ? "pos" : "neg"}">${fmtDeg(el - hz)}</b></div>
      </div>
      <p class="inst-next">${nextText(a, a.real.sunLit, i, "Sunrise over the terrain", "Sunset behind the terrain")}</p>`;
    }
    if (this.kind === "comms") {
      const el = tr.earthEl[i] as number, az = tr.earthAz[i] as number;
      const hz = a.real.earthHorizon[i] as number;
      const up = (a.real.earthUp[i] as number) === 1;
      const state = up ? "Earth in direct line of sight" : el > a.smoothDeg ? "Earth blocked by terrain" : "Earth below the horizon";
      const cls = up ? "ok" : el > a.smoothDeg ? "warn" : "bad";
      html += `<div class="inst-state ${cls} earth"><span class="dot"></span>${state}<small>dish pointing ${az.toFixed(1)}° · ${fmtDeg(el, 1)}</small></div>
      <div class="inst-grid">
        <div><label>Earth elevation</label><b>${fmtDeg(el)}</b></div>
        <div><label>Earth azimuth</label><b>${az.toFixed(1)}° <small>${compass(az)}</small></b></div>
        <div><label>Terrain horizon that way</label><b>${fmtDeg(hz)}</b></div>
        <div><label>Clearance</label><b class="${el - hz >= 0 ? "pos" : "neg"}">${fmtDeg(el - hz)}</b></div>
      </div>
      <p class="inst-next">${nextText(a, a.real.earthUp, i, "Earth rises over the terrain", "Earth sets behind the terrain")}</p>`;
    }
    const m = a.mReal, sm = a.mSmooth;
    if (this.kind === "solar") {
      html += `<div class="inst-sum"><div><label>Sunlit, next 30 days</label><b>${m.sunlitPct.toFixed(0)}%</b><small>smooth Moon: ${sm.sunlitPct.toFixed(0)}%</small></div>
        <div><label>Longest without sunlight</label><b>${fmtHours(m.longestDarkH, m.longestDarkOpen)}</b><small>smooth Moon: ${fmtHours(sm.longestDarkH, sm.longestDarkOpen)}</small></div></div>`;
    } else if (this.kind === "comms") {
      html += `<div class="inst-sum"><div><label>Earth in view, next 30 days</label><b>${m.earthPct.toFixed(0)}%</b><small>smooth Moon: ${sm.earthPct.toFixed(0)}%</small></div>
        <div><label>Longest blackout</label><b>${fmtHours(m.longestBlackoutH, m.longestBlackoutOpen)}</b><small>smooth Moon: ${fmtHours(sm.longestBlackoutH, sm.longestBlackoutOpen)}</small></div></div>
        <p class="inst-caveat">Line of sight is necessary, not sufficient: no antenna pattern, link budget, interference or relay satellite is modelled.</p>`;
    } else if (this.kind === "survey" && this.ref) {
      const r = analyse(this.data, this.ref, this.t0(), 30);
      const hzMax = a.skyline ? Math.max(...Array.from(a.skyline.horizon)) : 0;
      html += `<div class="inst-sum three">
        <div><label>S-1 · real terrain</label><b>${m.sunlitPct.toFixed(0)}%</b><small>sunlit · dark up to ${fmtHours(m.longestDarkH, m.longestDarkOpen)}</small></div>
        <div><label>S-1 · smooth Moon</label><b>${sm.sunlitPct.toFixed(0)}%</b><small>what ignoring terrain predicts</small></div>
        <div><label>Outpost · real</label><b>${r ? r.mReal.sunlitPct.toFixed(0) : "—"}%</b><small>${esc(this.distText())}</small></div></div>
        <p class="inst-next">Highest point of S-1's horizon: ${hzMax.toFixed(1)}°. The Sun here never climbs higher than ~${Math.max(...Array.from(tr.sunEl)).toFixed(1)}°.</p>`;
    }
    body.innerHTML = html;
    drawPanorama($("instPano") as HTMLCanvasElement, a, { mode: "real", now: i, compact: true });
    drawStrip($("instStrip") as HTMLCanvasElement, a, { mode: "real", now: i });
    $("instFoot").textContent = `Window: 30 days from ${fmtDate(a.t0)} · 30-min steps · horizon: ${a.status === "precomputed" ? "LOLA 10 m → 240 m, 260 km rays" : a.status === "live400" ? "LOLA 400 m (live)" : "smooth Moon only"} · Sun “visible” = ≥ 50% of the disc above the terrain.`;
  }

  distText(): string {
    if (!this.place || !this.ref) return "";
    const R = 1737.4e3, D = Math.PI / 180;
    const p1 = this.place.lat * D, p2 = this.ref.lat * D, dl = (this.ref.lon - this.place.lon) * D;
    const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    return `${Math.round(Math.acos(Math.min(1, c)) * R)} m away`;
  }

  resultText(): string {
    const a = this.analysis();
    if (!a || !this.kind) return "";
    const m = a.mReal, sm = a.mSmooth;
    const from = fmtDate(a.t0);
    if (this.kind === "solar") {
      return `Over the 30 days from ${from}, the Sun clears the real LOLA horizon at the outpost <b>${m.sunlitPct.toFixed(0)}%</b> of the time (a smooth Moon would say ${sm.sunlitPct.toFixed(0)}%). The longest stretch without direct sunlight is <b>${fmtHours(m.longestDarkH, m.longestDarkOpen)}</b> — that is the night a solar-powered lander's batteries and heaters must survive here.`;
    }
    if (this.kind === "comms") {
      return `Earth is in direct line of sight <b>${m.earthPct.toFixed(0)}%</b> of the next 30 days; the longest gap is <b>${fmtHours(m.longestBlackoutH, m.longestBlackoutOpen)}</b>. During a gap, a lander here cannot talk to Earth directly — it needs a relay orbiter or must operate on its own. (Line of sight is a precondition for a radio link, not a guarantee.)`;
    }
    const r = this.ref ? analyse(this.data, this.ref, this.t0(), 30) : null;
    const diff = sm.sunlitPct - m.sunlitPct;
    return `S-1 is ${this.distText()} from the outpost, yet it gets direct sunlight <b>${m.sunlitPct.toFixed(0)}%</b> of the time versus <b>${r ? r.mReal.sunlitPct.toFixed(0) : "—"}%</b> at the outpost. A smooth-Moon model predicts ${sm.sunlitPct.toFixed(0)}% at S-1 — ignoring the terrain ${diff >= 0 ? "overstates" : "understates"} its sunlight by <b>${Math.abs(diff).toFixed(0)} percentage points</b>. That is why landing-site work needs the real horizon.`;
  }
}
