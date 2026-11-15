// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Reality Check: every claim the app makes is re-tested here, live, in the
 * visitor's browser, and the measured numbers are shown — including failures.
 */

import { analyse, skylineFor, type Data, type Place } from "../data";
import { angularSeparationDeg, EARTH_RADIUS_DEG, skyAt, skyTrack } from "../science/sky";
import { computeSkyline, elevationAngleDeg, horizonAt, smoothHorizonDeg, toPolarXY, type TerrainGrid } from "../science/terrain";
import { discFractionAbove } from "../science/visibility";
import { SUN_RADIUS_DEG } from "../science/sky";
import { $, esc, fmtHours, fmtUtc } from "./format";

interface Fixture {
  cases: { site: string; lon: number; lat: number; body: "sun" | "earth"; t: number; az: number; el: number }[];
  retrieved_utc: string;
}

interface NasaIllum {
  sun: { sites: Record<string, { fraction?: number }> };
  earth: { sites: Record<string, { fraction?: number }> };
}

export interface SkyCheck {
  n: number;
  max: number;
  median: number;
  sunMax: number;
  earthMax: number;
  bySite: { site: string; n: number; sunMax: number; earthMax: number }[];
}

export async function runSkyCheck(data: Data): Promise<SkyCheck> {
  const fx = (await (await fetch("/data/validation/horizons_topocentric.json")).json()) as Fixture;
  const errs: { site: string; body: string; err: number }[] = [];
  for (const c of fx.cases) {
    const s = skyAt(data.table, c.t, c.lon, c.lat);
    if (!s) continue;
    const mine = c.body === "sun" ? s.sun : s.earth;
    errs.push({ site: c.site, body: c.body, err: angularSeparationDeg(mine, { az: c.az, el: c.el }) });
  }
  const sorted = errs.map((e) => e.err).sort((a, b) => a - b);
  const sites = [...new Set(errs.map((e) => e.site))];
  const maxOf = (f: (e: { site: string; body: string; err: number }) => boolean): number => Math.max(...errs.filter(f).map((e) => e.err));
  return {
    n: errs.length,
    max: sorted[sorted.length - 1] ?? NaN,
    median: sorted[Math.floor(sorted.length / 2)] ?? NaN,
    sunMax: maxOf((e) => e.body === "sun"),
    earthMax: maxOf((e) => e.body === "earth"),
    bySite: sites.map((site) => ({
      site,
      n: errs.filter((x) => x.site === site).length,
      sunMax: maxOf((e) => e.site === site && e.body === "sun"),
      earthMax: maxOf((e) => e.site === site && e.body === "earth"),
    })),
  };
}

function syntheticChecks(): { name: string; expected: number; got: number; tol: number }[] {
  const px = 400;
  const half = 120_000;
  const w = Math.round((2 * half) / px);
  const flat: TerrainGrid = { width: w, height: w, x0: -half, y0: half, px, data: new Int16Array(w * w) };
  const out: { name: string; expected: number; got: number; tol: number }[] = [];
  const f = computeSkyline(flat, 0, -89.5, 2, 60);
  if (f) out.push({ name: "Flat Moon, 2 m eye → geometric dip (deg)", expected: smoothHorizonDeg(2), got: Math.max(...f.horizon), tol: 0.01 });
  const wall: TerrainGrid = { ...flat, data: new Int16Array(w * w) };
  const [, sy] = toPolarXY(0, -89.5);
  const r0 = Math.floor((wall.y0 - (sy + 30_000)) / px);
  for (let r = r0 - 1; r <= r0; r++) for (let c = 0; c < w; c++) wall.data[r * w + c] = 2000;
  const sk = computeSkyline(wall, 0, -89.5, 2, 60);
  const nearEdge = wall.y0 - (r0 + 1) * px - sy;
  if (sk) out.push({ name: "2,000 m wall 30 km due north → exact curved angle (deg)", expected: elevationAngleDeg(0, 2, 2000, nearEdge), got: horizonAt(sk.horizon, 0), tol: 0.1 });
  out.push({ name: "Sun centre on the skyline → half the disc visible", expected: 0.5, got: discFractionAbove(1, 1, SUN_RADIUS_DEG), tol: 1e-9 });
  return out;
}

/** First sunset (terrain-aware) after a start time, scanning hourly up to `days`. */
function firstSunset(data: Data, p: Place, t0: number, days: number): number | null {
  const sk = skylineFor(data, p).skyline;
  const tr = skyTrack(data.table, t0, days * 24, 600, p.lon, p.lat);
  let wasLit = false;
  for (let i = 0; i < tr.n; i++) {
    const h = sk ? horizonAt(sk.horizon, tr.sunAz[i] as number) : smoothHorizonDeg(2);
    const lit = discFractionAbove(tr.sunEl[i] as number, h, SUN_RADIUS_DEG) >= 0.5;
    if (wasLit && !lit) return tr.t0 + i * tr.stepS;
    wasLit = lit;
  }
  return null;
}

function longTermAverages(data: Data, p: Place): { sun: number; earthAny: number } {
  const sk = skylineFor(data, p).skyline;
  const tr = skyTrack(data.table, data.table.start_unix, (data.table.n - 1), 3600, p.lon, p.lat);
  let sun = 0;
  let earth = 0;
  for (let i = 0; i < tr.n; i++) {
    const hs = sk ? horizonAt(sk.horizon, tr.sunAz[i] as number) : 0;
    const he = sk ? horizonAt(sk.horizon, tr.earthAz[i] as number) : 0;
    sun += discFractionAbove(tr.sunEl[i] as number, hs, SUN_RADIUS_DEG);
    earth += (tr.earthEl[i] as number) + EARTH_RADIUS_DEG > he ? 1 : 0;
  }
  return { sun: sun / tr.n, earthAny: earth / tr.n };
}

export async function renderReality(data: Data, sky: SkyCheck, grid: TerrainGrid | null): Promise<void> {
  const host = $("reality");
  const cards: string[] = [];
  const ok = (b: boolean): string => (b ? `<span class="pass">PASS</span>` : `<span class="fail">FAIL</span>`);

  cards.push(`<div class="rc-card glass"><h3>1 · Sun & Earth positions vs NASA/JPL Horizons ${ok(sky.max < 0.01)}</h3>
    <p>The app derives every Sun/Earth direction from one Horizons table. Here it is re-checked against <b>${sky.n}</b> answers Horizons computed itself for an observer standing on the Moon, at 5 sites (pole, landers, equator, far side), all sampled half-way between table rows (worst case). Error = angle on the sky.</p>
    <table class="rc-table"><tr><th>Site</th><th>Cases</th><th>Sun · max error</th><th>Earth · max error</th></tr>
    ${sky.bySite.map((r) => `<tr><td>${esc(r.site)}</td><td class="num">${r.n}</td><td class="num">${r.sunMax.toFixed(5)}°</td><td class="num">${r.earthMax.toFixed(5)}°</td></tr>`).join("")}
    <tr><td><b>All</b></td><td class="num">${sky.n}</td><td class="num"><b>${sky.sunMax.toFixed(5)}°</b></td><td class="num"><b>${sky.earthMax.toFixed(5)}°</b></td></tr></table>
    <p>The Sun agrees to under one arcsecond. Earth's residual (about 20 arcseconds, the same at every site because it lives in Earth's direction, not the site geometry) is about the size of the aberration of light, which the sub-point method does not model separately. It is roughly 1/300 of Earth's apparent width — far below anything the skyline can resolve.</p></div>`);

  const syn = syntheticChecks();
  cards.push(`<div class="rc-card glass"><h3>2 · Skyline geometry on synthetic terrain ${ok(syn.every((c) => Math.abs(c.got - c.expected) <= c.tol))}</h3>
    <p>Known answers, computed now with the same code that draws every skyline.</p>
    <table class="rc-table"><tr><th>Test</th><th>Expected</th><th>Got</th><th></th></tr>
    ${syn.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.expected.toFixed(4)}</td><td class="num">${c.got.toFixed(4)}</td><td>${ok(Math.abs(c.got - c.expected) <= c.tol)}</td></tr>`).join("")}</table></div>`);

  const precomputed = data.sites.sites.filter((s) => s.id && data.profiles.has(s.id) && s.lat <= -80);
  if (grid) {
    const rows = precomputed.map((s) => {
      const fine = data.profiles.get(s.id as string)!;
      const live = computeSkyline(grid, s.lon, s.lat, 2);
      if (!live) return `<tr><td>${esc(s.short)}</td><td colspan="3">no 400 m coverage</td></tr>`;
      let sum = 0;
      let mx = 0;
      for (let k = 0; k < 720; k++) {
        const d = Math.abs((live.horizon[k] as number) - (fine.horizon_deg[k] as number));
        sum += d;
        mx = Math.max(mx, d);
      }
      return `<tr><td>${esc(s.short)}</td><td class="num">${(sum / 720).toFixed(2)}°</td><td class="num">${mx.toFixed(2)}°</td><td>${esc(fine.dems[0] ?? "")}</td></tr>`;
    });
    cards.push(`<div class="rc-card glass"><h3>3 · Resolution: live 400 m skyline vs precomputed NASA LOLA skyline</h3>
      <p>Custom points use a 400 m grid computed in your browser; named sites use 20/80/240 m NASA Goddard DEMs. The difference shows how much to trust a custom point — it is largest where nearby small craters shape the horizon.</p>
      <table class="rc-table"><tr><th>Site</th><th>Mean |Δ|</th><th>Max |Δ|</th><th>Fine DEM near field</th></tr>${rows.join("")}</table></div>`);
  }

  const im1 = data.profiles.get("im1");
  if (im1) {
    cards.push(`<div class="rc-card glass"><h3>4 · Ground height at the Odysseus landing site</h3>
      <p>LOLA terrain used here: <b>${Math.round(im1.ground_m).toLocaleString()} m</b> above the 1,737.4 km sphere. Elevation reported for the site by NASA's LROC team in Feb 2024: <b>2,579 m</b>. Difference ${Math.abs(Math.round(im1.ground_m) - 2579)} m — an independent check that coordinates, projection and DEM line up.</p></div>`);
  }

  try {
    const nasa = (await (await fetch("/data/validation/nasa_illumination_at_sites.json")).json()) as NasaIllum;
    const rows: string[] = [];
    for (const s of data.sites.sites) {
      if (!s.id) continue;
      const ns = nasa.sun.sites[s.id]?.fraction;
      const ne = nasa.earth.sites[s.id]?.fraction;
      if (ns === undefined || ne === undefined) continue;
      const mine = longTermAverages(data, s);
      rows.push(`<tr><td>${esc(s.short)}</td><td class="num">${(mine.sun * 100).toFixed(1)}%</td><td class="num">${(ns * 100).toFixed(1)}%</td><td class="num">${(mine.earthAny * 100).toFixed(1)}%</td><td class="num">${(ne * 100).toFixed(1)}%</td></tr>`);
    }
    cards.push(`<div class="rc-card glass"><h3>5 · Long-term sunlight & Earth visibility vs NASA's own polar maps</h3>
      <p>NASA Goddard (Mazarico et al., PGDA product 69) averaged hourly illumination over <b>18.6 years</b> at 120 m/px. The app averages its own engine over the <b>5.4 years</b> in its Horizons table (Aug 2023 – Dec 2028), using NASA's rule for Earth (any part of the disc visible). Different periods, DEM versions and resolution, so agreement should be close, not exact.</p>
      <table class="rc-table"><tr><th>Site</th><th>Sun · ONE DEGREE</th><th>Sun · NASA map</th><th>Earth · ONE DEGREE</th><th>Earth · NASA map</th></tr>${rows.join("")}</table></div>`);
  } catch {
    cards.push(`<div class="rc-card glass"><h3>5 · NASA polar illumination maps</h3><p class="fail">Not validated — reference data failed to load.</p></div>`);
  }

  const ch3 = data.sites.sites.find((s) => s.id === "ch3");
  const im1p = data.sites.sites.find((s) => s.id === "im1");
  const ctx: string[] = [];
  if (ch3) {
    const t = firstSunset(data, ch3, Date.parse("2023-08-23T13:00:00Z") / 1000, 20);
    const sleep = Date.parse("2023-09-04T02:30:00Z") / 1000;
    ctx.push(`<tr><td>Chandrayaan-3 (Vikram)</td><td class="num">${t ? `${fmtUtc(t)} UTC` : "none in 20 d"}</td><td>ISRO put the lander to sleep at 2023-09-04 02:30 UTC, “a little before sunset”.</td><td class="num">${t ? `sleep ${fmtHours((t - sleep) / 3600)} before predicted sunset` : ""}</td></tr>`);
  }
  if (im1p) {
    const t = firstSunset(data, im1p, Date.parse("2024-02-23T00:00:00Z") / 1000, 20);
    ctx.push(`<tr><td>IM-1 Odysseus</td><td class="num">${t ? `${fmtUtc(t)} UTC` : "none in 20 d"}</td><td>Operated until about 29 Feb 2024 as lunar night approached (Intuitive Machines). It was lying on its side, so its panels caught little of the low Sun before geometric sunset.</td><td class="num">${t ? `ended ~${fmtHours((t - Date.parse("2024-02-29T12:00:00Z") / 1000) / 3600)} before predicted sunset` : ""}</td></tr>`);
  }
  cards.push(`<div class="rc-card glass"><h3>6 · Context: real landers and the lunar night</h3>
    <p>Predicted first sunset (Sun centre behind the real skyline) after each landing. Mission end times are public statements, not precise measurements, so this is context, not a pass/fail test. Athena is not listed: it tipped over, so its power loss was about orientation, not the horizon.</p>
    <table class="rc-table"><tr><th>Lander</th><th>Predicted sunset</th><th>What happened</th><th></th></tr>${ctx.join("")}</table></div>`);

  cards.push(`<div class="rc-card glass"><h3>What this does not check</h3><p>Solar-panel orientation and power, radio link budgets, boulders and slopes smaller than the DEM cells, and DEM errors (median ~0.3–0.5 m vertical in Goddard's best site DEMs). ONE DEGREE is a geometry tool for comparing sites and dates, not a landing-safety certification.</p></div>`);
  host.innerHTML = cards.join("");
  void analyse;
}
