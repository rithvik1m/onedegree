// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Scanner (slim field tool) and Planner (full-screen compare + date slip).
 */

import { analyse, groundHeightAt, skyNow, STEP_S, type Analysis, type Data, type Place } from "../data";
import { horizonAt } from "../science/terrain";
import { nextChange, type Metrics } from "../science/visibility";
import type { State, Store } from "../state";
import { drawPanorama, drawStrip, stripIndexFromEvent } from "./charts";
import { $, compass, esc, fmtDate, fmtDeg, fmtHours, fmtLat, fmtLon, fmtUtc } from "./format";

const DAY = 86400;

export function statusBadges(a: Analysis | null, horizonsMaxErr: number | null): string {
  const out: string[] = [];
  out.push(horizonsMaxErr !== null
    ? `<span class="badge ok" title="Measured against 200 Horizons topocentric answers">Horizons ephemeris · checked ±${horizonsMaxErr.toFixed(3)}°</span>`
    : `<span class="badge">Horizons ephemeris</span>`);
  if (!a) return out.join("");
  if (a.status === "precomputed") out.push(`<span class="badge ok" title="${esc(a.skyline?.source ?? "")}">LOLA terrain · ${esc(a.skyline?.resolution ?? "")}</span>`);
  else if (a.status === "live400") out.push(`<span class="badge warn" title="${esc(a.skyline?.source ?? "")}">LOLA terrain · 400 m live</span>`);
  else out.push(`<span class="badge bad">Geometric only — terrain not verified here</span>`);
  out.push(`<span class="badge">Eye 2 m · 30-min steps</span>`);
  return out.join("");
}

function metricTiles(m: Metrics, smooth: Metrics, base: Metrics | null, showSmooth: boolean): string {
  const d = (v: number, b: number | undefined, unit = "%"): string => {
    if (b === undefined) return "";
    const diff = v - b;
    if (Math.abs(diff) < 0.5) return "";
    return `<span class="delta ${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(0)}${unit}</span>`;
  };
  const dh = (v: number, b: number | undefined): string => {
    if (b === undefined || Math.abs(v - b) < 1) return "";
    const diff = v - b;
    return `<span class="delta ${diff < 0 ? "up" : "down"}">${diff > 0 ? "+" : "−"}${fmtHours(Math.abs(diff))}</span>`;
  };
  const sm = (v: string): string => (showSmooth ? `<div class="m-sub">smooth Moon: ${v}</div>` : "");
  return `
    <div class="metric sun"><div class="m-label">Sunlit</div><div class="m-value">${m.sunlitPct.toFixed(0)}%${d(m.sunlitPct, base?.sunlitPct)}</div>${sm(`${smooth.sunlitPct.toFixed(0)}%`)}</div>
    <div class="metric earth"><div class="m-label">Earth in view</div><div class="m-value">${m.earthPct.toFixed(0)}%${d(m.earthPct, base?.earthPct)}</div>${sm(`${smooth.earthPct.toFixed(0)}%`)}</div>
    <div class="metric both"><div class="m-label">Sun + Earth</div><div class="m-value">${m.bothPct.toFixed(0)}%${d(m.bothPct, base?.bothPct)}</div>${sm(`${smooth.bothPct.toFixed(0)}%`)}</div>
    <div class="metric"><div class="m-label">Longest night</div><div class="m-value">${fmtHours(m.longestDarkH, m.longestDarkOpen)}${dh(m.longestDarkH, base?.longestDarkH)}</div>${sm(fmtHours(smooth.longestDarkH, smooth.longestDarkOpen))}</div>
    <div class="metric"><div class="m-label">Longest Earth blackout</div><div class="m-value">${fmtHours(m.longestBlackoutH, m.longestBlackoutOpen)}${dh(m.longestBlackoutH, base?.longestBlackoutH)}</div>${sm(fmtHours(smooth.longestBlackoutH, smooth.longestBlackoutOpen))}</div>
    <div class="metric"><div class="m-label">Window</div><div class="m-value">${(m.windowHours / 24).toFixed(0)} d</div><div class="m-sub">from the date chosen</div></div>`;
}

function eventLine(a: Analysis, idx: number, mode: "real" | "smooth"): string {
  const v = mode === "real" ? a.real : a.smooth;
  const parts: string[] = [];
  const sunNext = nextChange(v.sunLit, idx);
  const earthNext = nextChange(v.earthUp, idx);
  const when = (i: number): string => `${fmtUtc(v.t0 + i * v.stepS)} UTC (in ${fmtHours(((i - idx) * v.stepS) / 3600)})`;
  if (v.sunLit[idx]) parts.push(sunNext >= 0 ? `Sunset ${when(sunNext)}` : "Sun stays up for the rest of the window");
  else parts.push(sunNext >= 0 ? `Sunrise ${when(sunNext)}` : "No sunrise in the window");
  if (v.earthUp[idx]) parts.push(earthNext >= 0 ? `Earthset ${when(earthNext)}` : "Earth stays in view for the rest of the window");
  else parts.push(earthNext >= 0 ? `Earthrise ${when(earthNext)}` : "Earth stays below the skyline all window");
  return parts.join(" · ");
}

export class Scanner {
  private analysis: Analysis | null = null;
  constructor(private data: Data, private store: Store, private horizonsErr: () => number | null) {
    const strip = $("scStrip") as HTMLCanvasElement;
    const seek = (ev: PointerEvent): void => {
      if (!this.analysis) return;
      const i = stripIndexFromEvent(strip, ev, this.analysis.track.n);
      this.store.set({ time: this.analysis.t0 + i * STEP_S });
    };
    strip.addEventListener("pointerdown", (ev) => {
      seek(ev);
      strip.setPointerCapture(ev.pointerId);
    });
    strip.addEventListener("pointermove", (ev) => {
      if (ev.buttons) seek(ev);
    });
    $("scClose").addEventListener("click", () => this.hide());
    for (const b of $("terrainSeg").querySelectorAll("button")) {
      b.addEventListener("click", () => this.store.set({ terrain: (b as HTMLElement).dataset.v as "real" | "smooth" }));
    }
    window.addEventListener("resize", () => this.isOpen() && this.render(this.store.s));
  }

  isOpen(): boolean {
    return !$("scanner").classList.contains("hidden");
  }
  show(): void {
    $("scanner").classList.remove("hidden");
    this.render(this.store.s);
  }
  hide(): void {
    $("scanner").classList.add("hidden");
  }
  toggle(): void {
    if (this.isOpen()) this.hide();
    else this.show();
  }

  render(s: State): void {
    for (const b of $("terrainSeg").querySelectorAll("button")) b.setAttribute("aria-checked", String((b as HTMLElement).dataset.v === s.terrain));
    if (!this.isOpen()) return;
    const p = s.here;
    const t0 = Math.floor(s.time / DAY) * DAY;
    const a = analyse(this.data, p, t0, 30);
    this.analysis = a;
    $("scName").textContent = p.name;
    const g = groundHeightAt(this.data, p);
    $("scCoords").textContent = `${fmtLat(p.lat)} · ${fmtLon(p.lon)}${g !== null ? ` · ${Math.round(g).toLocaleString()} m` : ""}`;
    $("scBadges").innerHTML = statusBadges(a, this.horizonsErr());
    const sky = skyNow(this.data, p, s.time);
    if (!a || !sky) {
      $("scSunBig").textContent = "Outside data";
      $("scSunSub").textContent = "Ephemeris covers Aug 2023 – Dec 2028";
      $("scEarthBig").textContent = "—";
      $("scEarthSub").textContent = "";
      return;
    }
    const idx = Math.max(0, Math.min(a.track.n - 1, Math.round((s.time - t0) / STEP_S)));
    const hz = (az: number): number => (s.terrain === "real" && a.skyline ? horizonAt(a.skyline.horizon, az) : a.smoothDeg);
    const sunClear = sky.sun.el - hz(sky.sun.az);
    const earthClear = sky.earth.el - hz(sky.earth.az);
    const vis = s.terrain === "real" ? a.real : a.smooth;
    const frac = vis.sunFrac[idx] ?? 0;
    $("scSunBig").innerHTML = frac >= 0.999 ? "In sunlight" : frac <= 0.001 ? (sky.sun.el > a.smoothDeg ? "Blocked by terrain" : "Below horizon") : `${(frac * 100).toFixed(0)}% of disc visible`;
    const ridge = a.skyline && s.terrain === "real" ? ` · ridge ${a.skyline.obstructionKm[Math.round(sky.sun.az / 0.5) % 720]?.toFixed(1)} km` : "";
    $("scSunSub").innerHTML = `az ${sky.sun.az.toFixed(1)}° ${compass(sky.sun.az)} · el ${fmtDeg(sky.sun.el)}<br>skyline ${fmtDeg(hz(sky.sun.az))} → clears by ${fmtDeg(sunClear)}${ridge}`;
    $("scEarthBig").textContent = earthClear > 0 ? "Line of sight" : sky.earth.el > a.smoothDeg ? "Blocked by terrain" : "Below horizon";
    $("scEarthSub").innerHTML = `az ${sky.earth.az.toFixed(1)}° ${compass(sky.earth.az)} · el ${fmtDeg(sky.earth.el)}<br>skyline ${fmtDeg(hz(sky.earth.az))} → clears by ${fmtDeg(earthClear)}`;
    drawPanorama($("scPano") as HTMLCanvasElement, a, { mode: s.terrain, now: idx, compact: true });
    drawStrip($("scStrip") as HTMLCanvasElement, a, { mode: s.terrain, now: idx });
    const m = s.terrain === "real" ? a.mReal : a.mSmooth;
    $("scMetrics").innerHTML = metricTiles(m, a.mSmooth, null, s.terrain === "real" && a.skyline !== null);
    $("scNote").innerHTML = `Next 30 days from ${fmtDate(t0)}. ${eventLine(a, idx, s.terrain)}. Hollow orange marks = visible on a smooth Moon but hidden by real terrain. “Earth in view” is line of sight, not a working radio link.`;
  }
}

export class Planner {
  constructor(private data: Data, private store: Store, private horizonsErr: () => number | null, private allPlaces: () => Place[]) {
    $("plClose").addEventListener("click", () => this.hide());
    for (const t of $("planner").querySelectorAll<HTMLButtonElement>(".tabs button")) {
      t.addEventListener("click", () => this.tab(t.dataset.tab as string));
    }
    const selA = $("selA") as HTMLSelectElement;
    const selB = $("selB") as HTMLSelectElement;
    selA.addEventListener("change", () => this.pick("a", selA.value));
    selB.addEventListener("change", () => this.pick("b", selB.value));
    const dateIn = $("dateIn") as HTMLInputElement;
    dateIn.addEventListener("change", () => {
      const t = Date.parse(`${dateIn.value}T00:00:00Z`) / 1000;
      if (Number.isFinite(t)) this.store.set({ landing: t, plannerIndex: 0 });
    });
    const slip = $("slipIn") as HTMLInputElement;
    slip.addEventListener("input", () => this.store.set({ slipDays: Number(slip.value) }));
    for (const b of $("winSeg").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => this.store.set({ windowDays: Number(b.dataset.v), plannerIndex: 0 }));
    for (const b of $("plTerrainSeg").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => this.store.set({ terrain: b.dataset.v as "real" | "smooth" }));
    const custom = (which: "a" | "b"): void => {
      const lat = Number(($("cuLat") as HTMLInputElement).value);
      const lon = Number(($("cuLon") as HTMLInputElement).value);
      if (!(lat >= -90 && lat <= 90) || !Number.isFinite(lon)) return;
      const p: Place = { name: `Custom point ${fmtLat(lat)}, ${fmtLon(lon)}`, short: "Custom", lat, lon: ((lon % 360) + 360) % 360, kind: "custom" };
      this.store.set(which === "a" ? { a: p } : { b: p });
    };
    $("cuAddA").addEventListener("click", () => custom("a"));
    $("cuAddB").addEventListener("click", () => custom("b"));
    window.addEventListener("resize", () => this.isOpen() && this.render(this.store.s));
  }

  isOpen(): boolean {
    return !$("planner").classList.contains("hidden");
  }
  show(tab = "compare"): void {
    $("planner").classList.remove("hidden");
    this.tab(tab);
  }
  hide(): void {
    $("planner").classList.add("hidden");
  }
  tab(name: string): void {
    for (const t of $("planner").querySelectorAll<HTMLButtonElement>(".tabs button")) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    for (const p of $("planner").querySelectorAll<HTMLElement>(".pl-body")) p.classList.toggle("hidden", p.dataset.panel !== name);
    if (name === "compare") this.render(this.store.s);
    window.dispatchEvent(new CustomEvent("planner-tab", { detail: name }));
  }

  private pick(which: "a" | "b", key: string): void {
    const p = this.allPlaces().find((x) => (x.id ?? x.name) === key);
    if (p) this.store.set(which === "a" ? { a: p } : { b: p });
  }

  private fillSelects(s: State): void {
    const places = this.allPlaces();
    for (const [id, cur] of [["selA", s.a], ["selB", s.b]] as [string, Place][]) {
      const sel = $(id) as HTMLSelectElement;
      const opts = [...places];
      if (!opts.some((p) => (p.id ?? p.name) === (cur.id ?? cur.name))) opts.push(cur);
      sel.innerHTML = opts.map((p) => `<option value="${esc(p.id ?? p.name)}">${esc(p.short ?? p.name)}</option>`).join("");
      sel.value = cur.id ?? cur.name;
    }
  }

  render(s: State): void {
    for (const b of $("plTerrainSeg").querySelectorAll("button")) b.setAttribute("aria-checked", String((b as HTMLElement).dataset.v === s.terrain));
    for (const b of $("winSeg").querySelectorAll("button")) b.setAttribute("aria-checked", String(Number((b as HTMLElement).dataset.v) === s.windowDays));
    if (!this.isOpen()) return;
    this.fillSelects(s);
    ($("dateIn") as HTMLInputElement).value = fmtUtc(s.landing, false);
    ($("slipIn") as HTMLInputElement).value = String(s.slipDays);
    $("slipOut").textContent = s.slipDays === 0 ? "on time" : `${s.slipDays > 0 ? "+" : "−"}${Math.abs(s.slipDays)} day${Math.abs(s.slipDays) === 1 ? "" : "s"}`;
    const t0 = s.landing + s.slipDays * DAY;
    const res: (Analysis | null)[] = [];
    const base: (Analysis | null)[] = [];
    for (const [col, p] of [["colA", s.a], ["colB", s.b]] as [string, Place][]) {
      const a = analyse(this.data, p, t0, s.windowDays);
      const b0 = s.slipDays !== 0 ? analyse(this.data, p, s.landing, s.windowDays) : null;
      res.push(a);
      base.push(b0);
      this.renderColumn($(col), p, a, b0, s);
    }
    this.renderVerdict(s, res[0] ?? null, res[1] ?? null, base[0] ?? null, base[1] ?? null);
  }

  private renderColumn(host: HTMLElement, p: Place, a: Analysis | null, base: Analysis | null, s: State): void {
    if (!a) {
      host.innerHTML = `<h3>${esc(p.name)}</h3><p class="dim">The chosen dates fall outside the ephemeris table (Aug 2023 – Dec 2028).</p>`;
      return;
    }
    const m = s.terrain === "real" ? a.mReal : a.mSmooth;
    const bm = base ? (s.terrain === "real" ? base.mReal : base.mSmooth) : null;
    const g = groundHeightAt(this.data, p);
    host.innerHTML = `
      <div><h3>${esc(p.name)}</h3>
      <div class="mono dim">${fmtLat(p.lat)} · ${fmtLon(p.lon)}${g !== null ? ` · ground ${Math.round(g).toLocaleString()} m` : ""}</div></div>
      <div class="badges">${statusBadges(a, this.horizonsErr())}</div>
      <canvas class="pano" height="200"></canvas>
      <div class="legend"><span><i style="background:#f2b544"></i>Sun (lit)</span><span><i style="background:#6fa8dc"></i>Earth (in view)</span><span><i style="background:transparent;box-shadow:inset 0 0 0 1.5px #ff8a5c"></i>hidden by terrain only</span></div>
      <canvas class="strip" height="96"></canvas>
      <div class="metrics">${metricTiles(m, a.mSmooth, bm, s.terrain === "real" && a.skyline !== null)}</div>
      <div class="note">${eventLine(a, Math.min(s.plannerIndex, a.track.n - 1), s.terrain)}</div>
      ${p.event ? `<div class="note">${esc(p.event)}</div>` : ""}
      ${p.source ? `<div class="src">Coordinates: ${esc(p.source)}</div>` : ""}`;
    const pano = host.querySelector("canvas.pano") as HTMLCanvasElement;
    const strip = host.querySelector("canvas.strip") as HTMLCanvasElement;
    const idx = Math.min(s.plannerIndex, a.track.n - 1);
    drawPanorama(pano, a, { mode: s.terrain, now: idx });
    drawStrip(strip, a, { mode: s.terrain, now: idx });
    const seek = (ev: PointerEvent): void => this.store.set({ plannerIndex: stripIndexFromEvent(strip, ev, a.track.n) });
    strip.addEventListener("pointerdown", (ev) => {
      seek(ev);
      strip.setPointerCapture(ev.pointerId);
    });
    strip.addEventListener("pointermove", (ev) => {
      if (ev.buttons) seek(ev);
    });
  }

  private renderVerdict(s: State, a: Analysis | null, b: Analysis | null, a0: Analysis | null, b0: Analysis | null): void {
    const host = $("verdict");
    if (!a || !b) {
      host.innerHTML = "Pick dates between Aug 2023 and Nov 2028 (the span of the NASA/JPL Horizons table shipped with the app).";
      return;
    }
    const mA = s.terrain === "real" ? a.mReal : a.mSmooth;
    const mB = s.terrain === "real" ? b.mReal : b.mSmooth;
    const t0 = s.landing + s.slipDays * DAY;
    const name = (p: Place): string => `<b>${esc(p.short ?? p.name)}</b>`;
    const parts: string[] = [];
    parts.push(`For the ${s.windowDays} days from <b>${fmtDate(t0)}</b>${s.slipDays ? ` (a ${Math.abs(s.slipDays)}-day ${s.slipDays > 0 ? "slip" : "advance"} from ${fmtDate(s.landing)})` : ""}:`);
    parts.push(`${name(s.a)} is sunlit ${mA.sunlitPct.toFixed(0)}% of the time and sees Earth ${mA.earthPct.toFixed(0)}%; ${name(s.b)} ${mB.sunlitPct.toFixed(0)}% and ${mB.earthPct.toFixed(0)}%.`);
    parts.push(`Both Sun and Earth together: ${mA.bothPct.toFixed(0)}% vs ${mB.bothPct.toFixed(0)}%. Longest night: ${fmtHours(mA.longestDarkH, mA.longestDarkOpen)} vs ${fmtHours(mB.longestDarkH, mB.longestDarkOpen)}.`);
    if (s.slipDays && a0 && b0) {
      const dA = mA.bothPct - (s.terrain === "real" ? a0.mReal : a0.mSmooth).bothPct;
      const dB = mB.bothPct - (s.terrain === "real" ? b0.mReal : b0.mSmooth).bothPct;
      parts.push(`The slip changes Sun-plus-Earth time by <b>${dA >= 0 ? "+" : "−"}${Math.abs(dA).toFixed(0)} points</b> at ${name(s.a)} and <b>${dB >= 0 ? "+" : "−"}${Math.abs(dB).toFixed(0)} points</b> at ${name(s.b)}.`);
    }
    if (s.terrain === "real" && a.skyline && b.skyline) {
      const gapA = a.mSmooth.sunlitPct - a.mReal.sunlitPct;
      const gapB = b.mSmooth.sunlitPct - b.mReal.sunlitPct;
      parts.push(`A smooth-Moon model would overstate sunlight by ${gapA.toFixed(0)} and ${gapB.toFixed(0)} points here — that gap is the terrain.`);
    } else if (!a.skyline || !b.skyline) {
      parts.push(`<span style="color:#e2a94b">One site has no verified terrain, so its numbers are smooth-Moon geometry only.</span>`);
    }
    parts.push(`<span class="dim">Geometry only: sunlight ≠ guaranteed power; Earth in view ≠ a working radio link; 2 m eye height; 30-minute steps.</span>`);
    host.innerHTML = parts.join(" ");
  }
}
