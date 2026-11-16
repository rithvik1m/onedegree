// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Field instruments (Solar station, Comms station, Survey scanner), in three levels:
 *   SIMPLE    — three plain-English observations, a simple sky picture, one conclusion;
 *   DETAILS   — angles, clearance, 360° skyline, 30-day timeline, time controls;
 *   ADVANCED  — NASA sources, the calculation for this instant, validation, limits.
 * Every level reads the SAME analysis (`analyse()` = Horizons × LOLA); nothing is
 * simplified by changing a number, only by choosing which ones to show.
 */

import { analyse, type Analysis, type Data, type Place } from "../data";
import { nextChange } from "../science/visibility";
import type { State, Store } from "../state";
import { drawPanorama, drawStrip, stripIndexFromEvent } from "./charts";
import { $, compass, esc, fmtDate, fmtDeg, fmtHours, fmtUtc } from "./format";

export type InstKind = "solar" | "comms" | "survey";
export type Level = "simple" | "details" | "advanced";

const TITLES: Record<InstKind, [string, string]> = {
  solar: ["Solar Monitoring Station", "Sun sensor · NASA/JPL Horizons × NASA LOLA terrain"],
  comms: ["Comms Station", "Line of sight to Earth · Horizons × LOLA"],
  survey: ["Field Scanner · Survey S-1", "Sunlight survey · real terrain vs a flat Moon"],
};

export interface InstrumentHooks {
  onRecord: (kind: InstKind, result: string) => void;
  onPath: (kind: InstKind, a: Analysis | null) => void;
  onSkyline: (on: boolean, a: Analysis | null) => void;
  validation?: () => { sun: number; earth: number; n: number } | null;
}

function idxOf(a: Analysis, t: number): number {
  return Math.max(0, Math.min(a.track.n - 1, Math.round((t - a.t0) / a.track.stepS)));
}

function hm(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h < 48) return `${Math.round(h)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

export const REQUIREMENT_SUN_PCT = 50;

export class Instrument {
  kind: InstKind | null = null;
  private place: Place | null = null;
  private ref: Place | null = null;
  private timer = 0;
  pathOn = true;
  skylineOn = false;
  level: Level = "simple";

  constructor(private data: Data, private store: Store, private t0: () => number, private hooks: InstrumentHooks) {
    try {
      const l = localStorage.getItem("onedegree.level") as Level | null;
      if (l === "simple" || l === "details" || l === "advanced") this.level = l;
    } catch {
      /* storage blocked */
    }
    $("instClose").addEventListener("click", () => this.close());
    $("instPlay").addEventListener("click", () => this.togglePlay());
    $("instBack").addEventListener("click", () => this.step(-24));
    $("instFwd").addEventListener("click", () => this.step(24));
    $("instNow").addEventListener("click", () => this.store.set({ time: this.t0() }));
    for (const b of $("instLevel").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => this.setLevel(b.dataset.v as Level));
    $("instPath").addEventListener("change", (e) => {
      this.pathOn = (e.target as HTMLInputElement).checked;
      this.hooks.onPath(this.kind as InstKind, this.pathOn ? this.analysis() : null);
    });
    $("instSky2").addEventListener("change", (e) => {
      this.skylineOn = (e.target as HTMLInputElement).checked;
      this.hooks.onSkyline(this.skylineOn, this.analysis());
    });
    $("instRecord").addEventListener("click", () => {
      if (!this.kind) return;
      this.hooks.onRecord(this.kind, this.resultText());
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
    window.addEventListener("resize", () => this.isOpen() && this.render(this.store.s));
  }

  setLevel(l: Level): void {
    this.level = l;
    try {
      localStorage.setItem("onedegree.level", l);
    } catch {
      /* ignore */
    }
    $("inst").dataset.level = l;
    for (const b of $("instLevel").querySelectorAll("button")) b.setAttribute("aria-checked", String((b as HTMLElement).dataset.v === l));
    this.render(this.store.s);
  }

  isOpen(): boolean {
    return this.kind !== null;
  }

  open(kind: InstKind, place: Place, ref: Place | null = null): void {
    this.kind = kind;
    this.place = place;
    this.ref = ref;
    const [t0, sub] = TITLES[kind];
    const t = kind === "survey" ? `Field Scanner · ${place.short}` : place.id === "outpost" ? t0 : `${t0.split(" · ")[0]} · ${place.short}`;
    $("instTitle").textContent = t;
    $("instSub").textContent = sub;
    const el = $("inst");
    el.classList.remove("hidden");
    el.dataset.kind = kind;
    el.dataset.level = this.level;
    el.scrollTop = 0;
    for (const b of $("instLevel").querySelectorAll("button")) b.setAttribute("aria-checked", String((b as HTMLElement).dataset.v === this.level));
    ($("instPath") as HTMLInputElement).checked = this.pathOn;
    ($("instSky2") as HTMLInputElement).checked = this.skylineOn;
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

  // ───────────────────────── rendering ─────────────────────────
  render(s: State): void {
    if (!this.kind || !this.place) return;
    const a = this.analysis();
    if (!a) {
      $("instObs").innerHTML = `<p class="note">No ephemeris for this date.</p>`;
      return;
    }
    const i = idxOf(a, s.time);
    $("instTime").textContent = `${fmtUtc(a.t0 + i * a.track.stepS)} UTC`;
    if (this.level === "simple") this.renderSimple(a, i);
    if (this.level === "details") this.renderDetails(a, i);
    if (this.level === "advanced") this.renderAdvanced(a, i);
    $("instFoot").textContent = this.level === "simple"
      ? "Same NASA data and calculation at every level — switch to Scientific details to see the angles."
      : `Window: 30 days from ${fmtDate(a.t0)} · 30-min steps · horizon: ${a.skyline ? a.skyline.resolution : "flat Moon only"} · Sun “visible” = at least half its disc above the terrain.`;
  }

  private body(a: Analysis, i: number): { el: number; az: number; hz: number; vis: boolean; frac: number; flags: Uint8Array; isSun: boolean; distKm: number } {
    const isSun = this.kind !== "comms";
    const tr = a.track;
    const el = (isSun ? tr.sunEl[i] : tr.earthEl[i]) as number;
    const az = (isSun ? tr.sunAz[i] : tr.earthAz[i]) as number;
    const hz = (isSun ? a.real.sunHorizon[i] : a.real.earthHorizon[i]) as number;
    const vis = (isSun ? a.real.sunLit[i] : a.real.earthUp[i]) === 1;
    const frac = isSun ? (a.real.sunFrac[i] as number) : vis ? 1 : 0;
    const flags = isSun ? a.real.sunLit : a.real.earthUp;
    let distKm = 0;
    if (a.skyline) {
      const n = a.skyline.obstructionKm.length;
      distKm = a.skyline.obstructionKm[Math.round((((az % 360) + 360) % 360) / (360 / n)) % n] as number;
    }
    return { el, az, hz, vis, frac, flags, isSun, distKm };
  }

  private renderSimple(a: Analysis, i: number): void {
    const b = this.body(a, i);
    const name = b.isSun ? "Sun" : "Earth";
    $("instQ").textContent = this.kind === "comms" ? "Can this spot talk straight to Earth?" : this.kind === "survey" ? `Is this spot as good for sunlight as ${this.ref?.short ?? "the station"}?` : "Will this spot get enough sunlight for our operations?";
    const flat = b.el > a.smoothDeg;
    const clear = b.el - b.hz;
    // 1 · visible now?
    let o1: [string, string, string];
    if (b.vis && b.frac < 0.999 && b.isSun) o1 = ["ok", `Yes — mostly`, `${Math.round(b.frac * 100)}% of the Sun's disc peeks over the land right now.`];
    else if (b.vis) o1 = ["ok", "Yes", b.isSun ? "Sunlight is reaching this spot right now." : "Earth is above the land here: a radio could point straight at it."];
    else if (flat) o1 = ["warn", "No", `The ${name} is up, but the land is in the way.`];
    else o1 = ["bad", "No", b.isSun ? "The Sun is below the horizon — it is local night here." : "Earth is below the horizon from here."];
    // 2 · terrain blocking?
    let o2: [string, string, string];
    if (!flat) o2 = ["bad", "Not the problem", `The ${name} is below even a perfectly flat horizon, so hills don't matter right now.`];
    else if (!b.vis) o2 = ["warn", "Yes", `A ridge${b.distKm ? ` about ${b.distKm < 1 ? (b.distKm * 1000).toFixed(0) + " m" : b.distKm.toFixed(1) + " km"} away` : ""} rises to ${b.hz.toFixed(1)}° — higher than the ${name} (${b.el.toFixed(1)}°). On a flat Moon this spot would ${b.isSun ? "be in sunlight" : "see Earth"}.`];
    else if (clear < 1) o2 = ["warn", "Almost", `The ${name} clears the land by only ${clear.toFixed(1)}° — about ${(clear / 0.53).toFixed(1)} Sun-widths. One degree decides.`];
    else o2 = ["ok", "No", `In the ${name}'s direction the land reaches ${b.hz.toFixed(1)}°; the ${name} is ${clear.toFixed(1)}° higher.`];
    // 3 · when will it change?
    const j = nextChange(b.flags, i);
    let o3: [string, string, string];
    if (j < 0) o3 = ["ok", "Not soon", `It stays ${b.vis ? (b.isSun ? "sunlit" : "in view") : b.isSun ? "dark" : "out of view"} for the rest of the next 30 days.`];
    else {
      const h = ((j - i) * a.track.stepS) / 3600;
      const when = fmtUtc(a.t0 + j * a.track.stepS);
      o3 = [b.vis ? "warn" : "ok", `In ${hm(h)}`, b.vis ? `${b.isSun ? "The Sun sinks behind the land" : "Earth slips behind the land"} at ${when} UTC.` : `${b.isSun ? "The Sun climbs back over the land" : "Earth rises over the land"} at ${when} UTC.`];
    }
    const qs = b.isSun ? ["Is the Sun visible right now?", "Is the land blocking it?", "When will that change?"] : ["Can we see Earth right now?", "Is the land blocking it?", "When will that change?"];
    const icon = (c: string): string => (c === "ok" ? "✓" : c === "warn" ? "!" : "–");
    $("instObs").innerHTML = [o1, o2, o3].map((o, k) => `<div class="ob ${o[0]}"><span class="ob-i">${icon(o[0])}</span><div><div class="ob-q">${qs[k]}</div><div class="ob-a"><b>${esc(o[1])}.</b> ${esc(o[2])}</div></div></div>`).join("");
    // conclusion
    const m = a.mReal, sm = a.mSmooth;
    let c = "";
    if (b.isSun) {
      const meets = m.sunlitPct >= REQUIREMENT_SUN_PCT;
      c = `<div class="c-big">${m.sunlitPct.toFixed(0)}%</div><div><b>of the next 30 days this spot gets direct sunlight.</b> ${m.longestDarkH === 0 ? "It never goes dark in this window." : `The longest dark spell is ${fmtHours(m.longestDarkH, m.longestDarkOpen)}.`}
        <div class="req ${meets ? "ok" : "bad"}">${meets ? "✓ Meets" : "✗ Fails"} the mission requirement: sunlight at least ${REQUIREMENT_SUN_PCT}% of the time.</div>
        ${Math.abs(sm.sunlitPct - m.sunlitPct) >= 5 ? `<div class="c-note">A flat-Moon model would have said ${sm.sunlitPct.toFixed(0)}% — the real terrain makes the difference.</div>` : ""}</div>`;
      if (this.kind === "survey" && this.ref) {
        const r = analyse(this.data, this.ref, this.t0(), 30);
        if (r) c += `<div class="c-cmp">For comparison, ${esc(this.ref.short)} (${esc(this.distText())}) gets <b>${r.mReal.sunlitPct.toFixed(0)}%</b>.</div>`;
      }
    } else {
      c = `<div class="c-big earth">${m.earthPct.toFixed(0)}%</div><div><b>of the next 30 days Earth is in direct line of sight.</b> The longest gap is ${fmtHours(m.longestBlackoutH, m.longestBlackoutOpen)}.
        <div class="c-note">Seeing Earth is needed for a direct radio link, but it is not a guarantee of one.</div></div>`;
    }
    $("instConclusion").innerHTML = c;
    drawSimpleSky($("instSky") as HTMLCanvasElement, a, b, name);
  }

  private renderDetails(a: Analysis, i: number): void {
    const b = this.body(a, i);
    const body = $("instBody");
    const tr = a.track;
    let html = "";
    if (b.isSun) {
      const state = b.vis ? "Direct sunlight" : b.el > a.smoothDeg ? "Sun hidden by terrain" : "Sun below the horizon";
      const cls = b.vis ? "ok" : b.el > a.smoothDeg ? "warn" : "bad";
      html += `<div class="inst-state ${cls}"><span class="dot"></span>${state}<small>${(b.frac * 100).toFixed(0)}% of the disc visible</small></div>`;
    } else {
      const state = b.vis ? "Earth in direct line of sight" : b.el > a.smoothDeg ? "Earth blocked by terrain" : "Earth below the horizon";
      const cls = b.vis ? "ok" : b.el > a.smoothDeg ? "warn" : "bad";
      html += `<div class="inst-state ${cls} earth"><span class="dot"></span>${state}<small>dish pointing ${b.az.toFixed(1)}° · ${fmtDeg(b.el, 1)}</small></div>`;
    }
    const nm = b.isSun ? "Sun" : "Earth";
    html += `<div class="inst-grid">
        <div><label>${nm} elevation</label><b>${fmtDeg(b.el)}</b></div>
        <div><label>${nm} azimuth</label><b>${b.az.toFixed(1)}° <small>${compass(b.az)}</small></b></div>
        <div><label>Terrain horizon that way</label><b>${fmtDeg(b.hz)}</b></div>
        <div><label>Clearance</label><b class="${b.el - b.hz >= 0 ? "pos" : "neg"}">${fmtDeg(b.el - b.hz)}</b></div>
      </div>`;
    const m = a.mReal, sm = a.mSmooth;
    if (this.kind === "solar") html += `<div class="inst-sum"><div><label>Sunlit, next 30 days</label><b>${m.sunlitPct.toFixed(0)}%</b><small>flat Moon: ${sm.sunlitPct.toFixed(0)}%</small></div><div><label>Longest without sunlight</label><b>${fmtHours(m.longestDarkH, m.longestDarkOpen)}</b><small>flat Moon: ${fmtHours(sm.longestDarkH, sm.longestDarkOpen)}</small></div></div>`;
    else if (this.kind === "comms") html += `<div class="inst-sum"><div><label>Earth in view, next 30 days</label><b>${m.earthPct.toFixed(0)}%</b><small>flat Moon: ${sm.earthPct.toFixed(0)}%</small></div><div><label>Longest blackout</label><b>${fmtHours(m.longestBlackoutH, m.longestBlackoutOpen)}</b><small>flat Moon: ${fmtHours(sm.longestBlackoutH, sm.longestBlackoutOpen)}</small></div></div><p class="inst-caveat">Line of sight is necessary, not sufficient: no antenna pattern, link budget, interference or relay satellite is modelled.</p>`;
    else if (this.ref) {
      const r = analyse(this.data, this.ref, this.t0(), 30);
      const hzMax = a.skyline ? Math.max(...Array.from(a.skyline.horizon)) : 0;
      html += `<div class="inst-sum three"><div><label>S-1 · real terrain</label><b>${m.sunlitPct.toFixed(0)}%</b><small>dark up to ${fmtHours(m.longestDarkH, m.longestDarkOpen)}</small></div><div><label>S-1 · flat Moon</label><b>${sm.sunlitPct.toFixed(0)}%</b><small>ignoring terrain</small></div><div><label>Outpost · real</label><b>${r ? r.mReal.sunlitPct.toFixed(0) : "—"}%</b><small>${esc(this.distText())}</small></div></div><p class="inst-next">Highest point of S-1's horizon: ${hzMax.toFixed(1)}°. The Sun never climbs above ~${Math.max(...Array.from(tr.sunEl)).toFixed(1)}° here.</p>`;
    }
    body.innerHTML = html;
    drawPanorama($("instPano") as HTMLCanvasElement, a, { mode: "real", now: i, compact: true });
    drawStrip($("instStrip") as HTMLCanvasElement, a, { mode: "real", now: i });
  }

  private renderAdvanced(a: Analysis, i: number): void {
    const b = this.body(a, i);
    const v = this.hooks.validation?.() ?? null;
    const sk = a.skyline;
    $("instAdv").innerHTML = `
      <div class="adv">
        <h4>This instant, step by step</h4>
        <ol>
          <li>NASA/JPL Horizons gives the ${b.isSun ? "sub-solar" : "sub-Earth"} point on the Moon (hourly table, interpolated) → ${b.isSun ? "Sun" : "Earth"} direction in the local east-north-up frame: azimuth <b>${b.az.toFixed(3)}°</b>, elevation <b>${b.el.toFixed(3)}°</b>.</li>
          <li>The LOLA skyline (720 great-circle rays, 0.5° apart, exact lunar curvature, 2 m eye height) gives the terrain horizon in that direction: <b>${b.hz.toFixed(3)}°</b>${b.distKm ? `, set by terrain <b>${b.distKm.toFixed(2)} km</b> away` : ""}.</li>
          <li>${b.isSun ? `Sun disc radius 0.2666°: <b>${(b.frac * 100).toFixed(1)}%</b> of the disc is above the horizon → ${b.vis ? "sunlit" : "not sunlit"} (threshold 50%).` : `Earth's centre is ${b.el > b.hz ? "above" : "below"} the horizon → ${b.vis ? "in view" : "not in view"}.`}</li>
          <li>Repeated every 30 minutes for 30 days from ${fmtDate(a.t0)} → the percentages and longest runs shown.</li>
        </ol>
        <h4>Data</h4>
        <ul>
          <li>Ephemeris: NASA/JPL Horizons API, Moon (301) as seen from Earth, quantities 14/15/20, hourly 2023-08-01 → 2029-01-01.</li>
          <li>Terrain: ${esc(sk ? sk.source : "none — flat Moon")}.</li>
          <li>Site: ${esc(this.place?.name ?? "")} — ${esc(this.place?.source ?? "")}</li>
        </ul>
        <h4>Validation (measured, not assumed)</h4>
        <ul>
          <li>Sun direction vs Horizons' own topocentric output: max error ${v ? v.sun.toFixed(4) + "°" : "≤ 0.0002°"}; Earth ${v ? v.earth.toFixed(4) + "°" : "≤ 0.006°"} (${v ? v.n : 200} cases).</li>
          <li>The 3D terrain you walk on reproduces this skyline to 0.019° mean, 0.153° max (Reality Check 7).</li>
        </ul>
        <h4>Limits</h4>
        <ul>
          <li>Geometry only: no panel orientation, power, dust or batteries; Earth line of sight is not a radio link budget.</li>
          <li>Terrain features smaller than the DEM cells (10 m near the outpost) are not resolved.</li>
        </ul>
      </div>`;
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
      return `Over the 30 days from ${from}, the outpost gets direct sunlight <b>${m.sunlitPct.toFixed(0)}%</b> of the time (a flat-Moon model would say ${sm.sunlitPct.toFixed(0)}%). The longest dark spell is <b>${fmtHours(m.longestDarkH, m.longestDarkOpen)}</b> — the night a solar-powered lander's batteries must survive here.`;
    }
    if (this.kind === "comms") {
      return `Earth is in direct line of sight <b>${m.earthPct.toFixed(0)}%</b> of the next 30 days; the longest gap is <b>${fmtHours(m.longestBlackoutH, m.longestBlackoutOpen)}</b>. During a gap a lander here cannot talk to Earth directly — it needs a relay orbiter or must work on its own.`;
    }
    const r = this.ref ? analyse(this.data, this.ref, this.t0(), 30) : null;
    const diff = sm.sunlitPct - m.sunlitPct;
    return `S-1 is ${this.distText()} from the outpost, yet it gets direct sunlight <b>${m.sunlitPct.toFixed(0)}%</b> of the time versus <b>${r ? r.mReal.sunlitPct.toFixed(0) : "—"}%</b> at the outpost. A flat-Moon model predicts ${sm.sunlitPct.toFixed(0)}% at S-1 — ignoring the terrain ${diff >= 0 ? "overstates" : "understates"} its sunlight by <b>${Math.abs(diff).toFixed(0)} percentage points</b>.`;
  }
}

/** The simple picture: ±60° of sky around the Sun (or Earth), the real land outline, a flat-Moon line, and the body. */
function drawSimpleSky(c: HTMLCanvasElement, a: Analysis, b: { el: number; az: number; hz: number; vis: boolean; isSun: boolean }, name: string): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = c.clientWidth || 380, H = 150;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const span = 60;
  const sky = a.skyline;
  const hzAt = (az: number): number => {
    if (!sky) return a.smoothDeg;
    const n = sky.horizon.length;
    const f = ((((az % 360) + 360) % 360) / 360) * n;
    const i0 = Math.floor(f) % n;
    const t = f - Math.floor(f);
    return (sky.horizon[i0] as number) * (1 - t) + (sky.horizon[(i0 + 1) % n] as number) * t;
  };
  let lo = Math.min(a.smoothDeg, b.el) - 1.5, hi = Math.max(b.el, b.hz) + 2.5;
  for (let d = -span; d <= span; d += 2) { const h = hzAt(b.az + d); lo = Math.min(lo, h - 0.8); hi = Math.max(hi, h + 1); }
  const X = (d: number): number => ((d + span) / (2 * span)) * W;
  const Y = (e: number): number => H - 18 - ((e - lo) / (hi - lo)) * (H - 30);
  // sky
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#05060a");
  grd.addColorStop(1, "#0d0f14");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // body (drawn before the land so the land hides it when it is behind)
  const bx = X(0), by = Y(b.el);
  const r = 10;
  if (b.isSun) {
    const glow = g.createRadialGradient(bx, by, 2, bx, by, 34);
    glow.addColorStop(0, "rgba(255,220,150,0.9)");
    glow.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = glow;
    g.beginPath(); g.arc(bx, by, 34, 0, 7); g.fill();
    g.fillStyle = "#fff4d6";
  } else g.fillStyle = "#6fa8dc";
  g.beginPath(); g.arc(bx, by, r, 0, 7); g.fill();
  // land
  g.beginPath();
  g.moveTo(0, H);
  for (let d = -span; d <= span; d += 1) g.lineTo(X(d), Y(hzAt(b.az + d)));
  g.lineTo(W, H);
  g.closePath();
  g.fillStyle = "#2a2724";
  g.fill();
  g.strokeStyle = "#cfc6b6";
  g.lineWidth = 1.5;
  g.beginPath();
  for (let d = -span; d <= span; d += 1) { const x = X(d), y = Y(hzAt(b.az + d)); if (d === -span) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
  // flat-Moon horizon
  g.setLineDash([5, 5]);
  g.strokeStyle = "rgba(236,230,218,0.45)";
  g.beginPath(); g.moveTo(0, Y(a.smoothDeg)); g.lineTo(W, Y(a.smoothDeg)); g.stroke();
  g.setLineDash([]);
  g.fillStyle = "rgba(236,230,218,0.6)";
  g.font = "600 10.5px Inter, sans-serif";
  g.fillText("flat-Moon horizon", 6, Y(a.smoothDeg) - 5);
  // hidden body outline on top
  if (!b.vis && b.el > a.smoothDeg) {
    g.setLineDash([3, 3]);
    g.strokeStyle = b.isSun ? "#ffb347" : "#6fa8dc";
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(bx, by, r, 0, 7); g.stroke();
    g.setLineDash([]);
  }
  g.fillStyle = b.isSun ? "#ffd27a" : "#a9cdf0";
  g.font = "700 12px Inter, sans-serif";
  g.textAlign = "center";
  g.fillText(b.vis ? name : `${name} (behind the land)`, bx, Math.max(14, by - 16));
  g.fillStyle = "rgba(236,230,218,0.55)";
  g.font = "600 10.5px Inter, sans-serif";
  g.fillText(compass(b.az - span), 18, H - 4);
  g.fillText(compass(b.az), W / 2, H - 4);
  g.fillText(compass(b.az + span), W - 18, H - 4);
  g.textAlign = "left";
  g.fillStyle = "rgba(236,230,218,0.4)";
  g.fillText("heights stretched so you can see them", W - 200, 14);
}
