// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * ONE DEGREE v2 — a science-first lunar research mission.
 * Surface: Three.js world built from NASA LOLA terrain (src/surface).
 * Orbit: CesiumJS globe (src/cesium), loaded on first launch to orbit.
 * Science: one shared engine (src/science + data.ts) feeding instruments,
 * scanner, planner and Reality Check.
 */

import "./styles.css";
import { analyse, loadCore, loadGrid, skyNow, type Data, type Place } from "./data";
import type { MoonScene } from "./cesium/moon";
import { skyAt, subpointsAt, earthVectorKm, sunVectorKm } from "./science/sky";
import { Store, readUrl, type State } from "./state";
import { $, compass, fmtDate, fmtHours, fmtLat, fmtLon, fmtUtc } from "./ui/format";
import { Planner, Scanner } from "./ui/panels";
import { renderReality, runSkyCheck, type SkyCheck } from "./ui/reality";
import { renderAbout } from "./ui/about";
import { PolarMap } from "./ui/polarmap";
import { Instrument, type InstKind } from "./ui/instrument";
import { Campaign, MISSIONS, type Mission } from "./game/missions";
import { SurfaceWorld } from "./surface/world";
import { loadPatch, patchFromGrid, smoothPatch, groundY, lonLatToScene, type SurfacePatch } from "./surface/terrain3d";
import { shared } from "./surface/materials";
import { runDemo } from "./demo";
import * as sfx from "./ui/sfx";

const TOKEN_KEY = "onedegree.ionToken";
const D2R = Math.PI / 180;

function toast(msg: string, ms = 3800): void {
  const t = $("toast");
  t.innerHTML = msg;
  t.classList.add("show");
  window.clearTimeout((toast as unknown as { h?: number }).h);
  (toast as unknown as { h?: number }).h = window.setTimeout(() => t.classList.remove("show"), ms);
}

let captionTimer = 0;
export function caption(text: string, ms = 3000): void {
  const c = $("caption");
  c.textContent = text;
  c.classList.add("show");
  window.clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => c.classList.remove("show"), ms);
}

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
async function fade(on: boolean, ms = 450): Promise<void> {
  const f = $("fade");
  f.style.transitionDuration = `${ms}ms`;
  f.classList.toggle("on", on);
  await wait(ms);
}

function token(): string | null {
  const env = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim();
  if (env) return env;
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    return v || null;
  } catch {
    return null;
  }
}

let cesiumLoading: Promise<boolean> | null = null;
function loadCesium(): Promise<boolean> {
  if ((window as unknown as { Cesium?: unknown }).Cesium) return Promise.resolve(true);
  cesiumLoading ??= new Promise((res) => {
    const base = "https://cesium.com/downloads/cesiumjs/releases/1.143/Build/Cesium/";
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${base}Widgets/widgets.css`;
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = `${base}Cesium.js`;
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
  return cesiumLoading;
}

/** First mission hour from 15 Nov 2026 when the outpost has Sun AND Earth while S-1 is in shadow. */
function chooseClock(data: Data, outpost: Place, survey: Place, windowT0: number): number {
  const a = analyse(data, outpost, windowT0, 30);
  const b = analyse(data, survey, windowT0, 30);
  if (!a || !b) return windowT0;
  let fallback = -1;
  for (let i = 0; i < a.track.n; i++) {
    const good = a.real.sunLit[i] && a.real.earthUp[i] && (a.track.sunEl[i] as number) > 0.6;
    if (good && fallback < 0) fallback = i;
    if (good && !b.real.sunLit[i]) return windowT0 + i * a.track.stepS;
  }
  return windowT0 + Math.max(0, fallback) * a.track.stepS;
}

async function boot(): Promise<void> {
  const bootText = $("bootText");
  const progress = (s: string): void => {
    bootText.textContent = s;
  };
  let data: Data;
  try {
    data = await loadCore(progress);
  } catch (e) {
    progress(`Could not load NASA data: ${(e as Error).message}`);
    return;
  }
  progress("Loading LOLA south-pole terrain…");
  try {
    data.grid = await loadGrid();
  } catch {
    data.grid = null;
  }
  const sites = data.sites.sites;
  const byId = (id: string): Place => sites.find((s) => s.id === id) as Place;
  const outpost = byId("outpost");
  const survey = byId("survey");
  const athena = byId("im2");
  const odysseus = byId("im1");
  progress("Loading NASA LOLA 10 m terrain around the outpost…");
  const patches = new Map<string, SurfacePatch>();
  patches.set("outpost", await loadPatch("outpost"));

  const windowT0 = Date.UTC(2026, 10, 15) / 1000;
  const clock0 = chooseClock(data, outpost, survey, windowT0);
  const url = readUrl();

  const store = new Store({
    here: outpost,
    time: url.t ?? clock0,
    terrain: "real",
    mode: "surface",
    a: athena,
    b: odysseus,
    landing: Math.floor(clock0 / 86400) * 86400,
    slipDays: 0,
    windowDays: 30,
    plannerIndex: 0,
  });

  let skyCheck: SkyCheck | null = null;
  const horizonsErr = (): number | null => (skyCheck ? skyCheck.max : null);
  const allPlaces = (): Place[] => [...sites, data.sites.reference];
  const scanner = new Scanner(data, store, horizonsErr);
  const planner = new Planner(data, store, horizonsErr, allPlaces);
  renderAbout();
  const polarMap = new PolarMap(store, allPlaces);

  let moon: MoonScene | null = null;
  // ---------- the surface world ----------
  progress("Building the surface…");
  let live = { lon: outpost.lon, lat: outpost.lat };
  const world = new SurfaceWorld($("surface"), {
    onPrompt: (t) => {
      if (t) sfx.blip();
      $("prompt").classList.toggle("hidden", !t);
      if (t) $("promptText").textContent = t;
    },
    onInteract: (id) => interact(id),
    onMove: (lon, lat) => {
      live = { lon, lat };
      $("roCoords").textContent = `${fmtLat(lat)} ${fmtLon(lon)}`;
      // the scanner follows you between the outpost and S-1
      if (world.outpost && store.s.mode === "surface") {
        const [sx, sz] = world.sceneOf(survey.lon, survey.lat);
        const nearSurvey = Math.hypot(world.player.pos.x - sx, world.player.pos.z - sz) < 40;
        const want = nearSurvey ? survey : outpost;
        if (store.s.here.id !== want.id) store.set({ here: want });
      }
    },
    onPointerLock: (locked) => {
      $("crosshair").classList.toggle("hidden", !locked || world.player.thirdPerson);
      document.body.classList.toggle("locked", locked);
    },
  });

  const updateSky = (s: State): void => {
    const p = world.patch;
    const lon = p ? p.lon : s.here.lon, lat = p ? p.lat : s.here.lat;
    const sk = skyAt(data.table, s.time, lon, lat, 0);
    const sp = subpointsAt(data.table, s.time);
    if (!sk || !sp) return;
    world.applySky({ sunAz: sk.sun.az, sunEl: sk.sun.el, earthAz: sk.earth.az, earthEl: sk.earth.el, distKm: sp.distKm, unix: s.time });
    if (moon) moon.setSky(sunVectorKm(sp), earthVectorKm(sp));
  };

  updateSky(store.s);
  world.setSite(patches.get("outpost") as SurfacePatch, { outpost: true, survey });

  const modeLabel = (): string => {
    if (store.s.mode === "orbit") return "Orbit · " + (moon?.usingTiles ? "Cesium Moon tiles" : "NASA Moon Trek imagery");
    return world.patch ? world.patch.label : "Surface";
  };
  const updateReadout = (s: State): void => {
    $("roSite").textContent = s.here.short ?? s.here.name;
    $("roTime").textContent = `${fmtUtc(s.time)} UTC`;
    $("roMode").textContent = modeLabel();
    $("btnOrbitLabel").textContent = s.mode === "surface" ? "Orbit" : "Land";
    $("orbitBar").classList.toggle("hidden", s.mode !== "orbit");
    document.body.classList.toggle("in-orbit", s.mode === "orbit");
  };

  // ---------- instruments & campaign ----------
  let lastResult = "";
  const instrument = new Instrument(data, store, () => windowT0, {
    onRecord: (kind, result) => {
      lastResult = result;
      const m = campaign.mission;
      const st = campaign.step;
      const completes = !!(m && st && st.done({ type: "record", id: kind }) && campaign.si === m.steps.length - 1);
      campaign.emit({ type: "record", id: kind });
      if (!completes) showDebrief("Observation recorded", stationName(kind), result, false);
    },
    onPath: (kind, a) => {
      if (!a) return world.sky.setPath(null, 0);
      const pts: { az: number; el: number; visible: boolean }[] = [];
      const tr = a.track;
      for (let i = 0; i < tr.n; i += 1) {
        if (kind === "comms") pts.push({ az: tr.earthAz[i] as number, el: tr.earthEl[i] as number, visible: a.real.earthUp[i] === 1 });
        else pts.push({ az: tr.sunAz[i] as number, el: tr.sunEl[i] as number, visible: a.real.sunLit[i] === 1 });
      }
      world.sky.setPath(pts, kind === "comms" ? 0x6fa8dc : 0xf2b544);
    },
    onSkyline: (on, a) => world.sky.setSkyline(on && a?.skyline ? a.skyline.horizon : null),
  });
  const stationName = (k: InstKind): string => (k === "solar" ? "Solar Monitoring Station" : k === "comms" ? "Comms Station" : "Survey point S-1");

  const showDebrief = (kicker: string, title: string, text: string, mission: boolean): void => {
    sfx.chime();
    $("dbKicker").textContent = kicker;
    $("dbTitle").textContent = title;
    $("dbText").innerHTML = text;
    ($("dbNext") as HTMLButtonElement).style.display = mission ? "" : "none";
    $("dbFree").textContent = mission ? "Explore freely" : "Close";
    if (document.pointerLockElement) document.exitPointerLock();
    const d = $("debrief") as HTMLDialogElement;
    if (!d.open) d.showModal();
  };

  const missionResult = (m: Mission): string => {
    if (m.id === "m1" || m.id === "m2" || m.id === "m3") return lastResult;
    const t = store.s.landing + store.s.slipDays * 86400;
    const A = analyse(data, store.s.a, t, store.s.windowDays);
    const B = analyse(data, store.s.b, t, store.s.windowDays);
    if (!A || !B) return "No ephemeris for that date.";
    const a = A.mReal.bothPct, b = B.mReal.bothPct;
    const win = a === b ? null : a > b ? "a" : "b";
    const name = (w: "a" | "b"): string => (w === "a" ? store.s.a.short : store.s.b.short);
    if (m.id === "m4") {
      const verdict = win === null ? "The two sites tie on this requirement." : win === chosen ? `Your choice matches the data: <b>${name(win)}</b>.` : `The data favour <b>${name(win)}</b> rather than your pick.`;
      return `${verdict} Over ${store.s.windowDays} days from ${fmtDate(t)}, Sun <i>and</i> Earth are both in view <b>${a.toFixed(0)}%</b> of the time at ${store.s.a.short} and <b>${b.toFixed(0)}%</b> at ${store.s.b.short}. Sunlight alone: ${A.mReal.sunlitPct.toFixed(0)}% vs ${B.mReal.sunlitPct.toFixed(0)}%; longest night ${fmtHours(A.mReal.longestDarkH, A.mReal.longestDarkOpen)} vs ${fmtHours(B.mReal.longestDarkH, B.mReal.longestDarkOpen)}.`;
    }
    const A0 = analyse(data, store.s.a, store.s.landing, store.s.windowDays);
    const B0 = analyse(data, store.s.b, store.s.landing, store.s.windowDays);
    const a0 = A0?.mReal.bothPct ?? 0, b0 = B0?.mReal.bothPct ?? 0;
    const win0 = a0 === b0 ? null : a0 > b0 ? "a" : "b";
    return `With a 7-day slip, Sun + Earth together: ${store.s.a.short} ${a0.toFixed(0)}% → <b>${a.toFixed(0)}%</b>, ${store.s.b.short} ${b0.toFixed(0)}% → <b>${b.toFixed(0)}%</b>. ${win0 === win ? "The better site stays the same — but the margins moved." : "The better site <b>changes</b> — a one-week slip flips the answer."} Polar mission plans must be re-checked for every launch date.`;
  };
  let chosen: "a" | "b" | null = null;

  const campaign = new Campaign(
    () => renderMission(),
    (m) => {
      renderMission();
      const n = MISSIONS.findIndex((x) => x.id === m.id);
      showDebrief(`Mission ${m.num} complete`, m.title, missionResult(m), n + 1 < MISSIONS.length);
    },
  );
  $("dbNext").addEventListener("click", () => {
    ($("debrief") as HTMLDialogElement).close();
    campaign.next();
    const m = campaign.mission;
    if (m) caption(`Mission ${m.num} · ${m.title}`, 2600);
  });
  $("dbFree").addEventListener("click", () => {
    ($("debrief") as HTMLDialogElement).close();
    if (campaign.active && campaign.step === null) campaign.stop();
  });
  $("mWhy").addEventListener("click", () => {
    const open = $("mWhyText").classList.toggle("hidden");
    $("mWhy").setAttribute("aria-expanded", String(!open));
  });

  const targetPos = (id: string | undefined): { x: number; z: number } | null => {
    if (!id || !world.outpost) return null;
    const it = world.outpost.interactables.find((i) => i.id === id);
    return it ? { x: it.x, z: it.z } : null;
  };
  function renderMission(): void {
    const m = campaign.mission;
    const st = campaign.step;
    $("mission").classList.toggle("hidden", !m || !st);
    renderMissionBar();
    if (!m || !st) {
      world.setWaypoint(null);
      return;
    }
    $("mNum").textContent = `MISSION ${m.num}`;
    $("mTitle").textContent = m.title;
    $("mText").textContent = st.text;
    $("mWhyText").textContent = m.why;
    const tp = targetPos(st.target);
    world.setWaypoint(tp);
    $("mission").querySelector(".m-nav")?.classList.toggle("hidden", !tp);
  }
  // waypoint arrow + distance, 5x a second
  window.setInterval(() => {
    const st = campaign.step;
    const tp = targetPos(st?.target);
    if (!tp || store.s.mode !== "surface") return;
    const p = world.player;
    const dx = tp.x - p.pos.x, dz = tp.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const brg = Math.atan2(dx, -dz);
    const rel = brg - (p.thirdPerson ? -world.camera.rotation.y : p.yaw);
    ($("mArrow") as HTMLElement).style.transform = `rotate(${rel}rad)`;
    $("mDist").textContent = d < 3 ? "here" : `${d < 1000 ? d.toFixed(0) + " m" : (d / 1000).toFixed(2) + " km"} · ${compass((brg / D2R + 360) % 360)}`;
  }, 200);

  function renderMissionBar(): void {
    const bar = $("missionBar");
    const m = campaign.mission;
    const st = campaign.step;
    if (!m || !st || (m.id !== "m4" && m.id !== "m5") || campaign.si === 0 && m.id === "m4") {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    if (m.id === "m4") {
      bar.innerHTML = `<div><b>Mission 04 · requirement</b> — a solar-powered lander must make power <i>and</i> talk to Earth. Which site has Sun + Earth together for more of the window?</div>
        <div class="mb-actions"><button class="pill primary small" data-c="a">Choose ${store.s.a.short}</button><button class="pill primary small" data-c="b">Choose ${store.s.b.short}</button></div>`;
      for (const b of bar.querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => {
        chosen = b.dataset.c as "a" | "b";
        planner.hide();
        campaign.emit({ type: "choose", site: chosen });
      });
    } else {
      bar.innerHTML = `<div><b>Mission 05 · the delay</b> — the launch slips one week. Move <i>Schedule slip</i> to <b>+7 days</b> and watch the verdict.</div>`;
    }
  }

  // ---------- interactions ----------
  function interact(id: string): void {
    sfx.open();
    campaign.emit({ type: "interact", id });
    if (id === "solar") instrument.open("solar", outpost);
    else if (id === "comms") instrument.open("comms", outpost);
    else if (id === "survey") instrument.open("survey", survey, outpost);
    else if (id === "control") void enterControl();
    else if (id === "console") openControl();
    else if (id === "exit") void exitControl();
    else if (id === "deck") {
      const a = analyse(data, outpost, windowT0, 30);
      instrument.skylineOn = !instrument.skylineOn;
      world.sky.setSkyline(instrument.skylineOn && a?.skyline ? a.skyline.horizon : null);
      caption(instrument.skylineOn ? "You are looking WSW into Shackleton crater — its floor lies about 4 km below this rim and never sees direct sunlight. The teal line is the horizon the scanner computes from NASA LOLA terrain; it traces the 3D ridges because both come from the same data." : "Horizon trace off", 9000);
    } else if (id === "lander") void goOrbit();
  }
  async function enterControl(): Promise<void> {
    if (world.inside) return;
    instrument.close();
    await fade(true, 300);
    const it = world.outpost?.interactables.find((i) => i.id === "control");
    world.enterInterior({ x: (it?.x ?? 0) + 1.5, z: it?.z ?? 0, yaw: Math.PI / 2 });
    refreshScreens();
    $("roMode").textContent = "Inside Mission Control (simulated set)";
    document.body.classList.add("indoors");
    await fade(false, 350);
    if (!document.body.classList.contains("demo")) caption("Mission Control (simulated). The console runs the same Horizons × LOLA engine as the field instruments.", 4200);
  }
  async function exitControl(): Promise<void> {
    if (!world.inside) return;
    planner.hide();
    document.body.classList.remove("console");
    await fade(true, 300);
    world.exitInterior();
    document.body.classList.remove("indoors");
    $("roMode").textContent = modeLabel();
    await fade(false, 350);
  }
  function refreshScreens(): void {
    const inn = world.interior;
    if (!inn || !world.inside) return;
    const t = store.s.landing + store.s.slipDays * 86400;
    const A = analyse(data, store.s.a, t, store.s.windowDays);
    const B = analyse(data, store.s.b, t, store.s.windowDays);
    const now = analyse(data, outpost, windowT0, 30);
    const i = now ? Math.max(0, Math.min(now.track.n - 1, Math.round((store.s.time - now.t0) / now.track.stepS))) : 0;
    const amber = "#ffd27a", blue = "#a9cdf0", teal = "#8fe0d4";
    inn.setScreen(0, "OUTPOST · NOW", now ? [
      ["Mission clock (UTC)", fmtUtc(store.s.time).slice(5)],
      ["Sun elevation", `${(now.track.sunEl[i] as number).toFixed(2)}°`, amber],
      ["Sun", now.real.sunLit[i] ? "DIRECT" : "SHADOW", now.real.sunLit[i] ? amber : "#ff9b82"],
      ["Earth", now.real.earthUp[i] ? "IN VIEW" : "BLOCKED", now.real.earthUp[i] ? blue : "#ff9b82"],
      ["Missions done", `${campaign.done.size} / ${MISSIONS.length}`],
    ] : []);
    inn.setScreen(1, `SITE COMPARISON · ${store.s.windowDays} d from ${fmtDate(t)}`, A && B ? [
      [`Sunlit · ${store.s.a.short}`, `${A.mReal.sunlitPct.toFixed(0)}%`, amber],
      [`Sunlit · ${store.s.b.short}`, `${B.mReal.sunlitPct.toFixed(0)}%`, amber],
      [`Earth in view · ${store.s.a.short}`, `${A.mReal.earthPct.toFixed(0)}%`, blue],
      [`Earth in view · ${store.s.b.short}`, `${B.mReal.earthPct.toFixed(0)}%`, blue],
      [`Sun + Earth · A / B`, `${A.mReal.bothPct.toFixed(0)}% / ${B.mReal.bothPct.toFixed(0)}%`, teal],
    ] : []);
    polarMap.draw(store.s);
    inn.setScreen(2, "SOUTH POLE · NASA SUNLIGHT MAP", [], $("polarMap") as HTMLCanvasElement);
  }

  function openControl(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.add("console");
    planner.show("compare");
    polarMap.draw(store.s);
    campaign.emit({ type: "planner" });
    renderMissionBar();
  }

  // ---------- orbit & landing ----------
  let busy = false;
  let pending: { lon: number; lat: number; place?: Place } | null = null;

  async function ensureMoon(): Promise<MoonScene | null> {
    if (moon) return moon;
    const ok = await loadCesium();
    if (!ok) {
      toast("Could not load the orbit globe (CesiumJS). The surface and all science still work.", 7000);
      return null;
    }
    const { MoonScene } = await import("./cesium/moon");
    try {
      $("viewer").classList.remove("hidden");
      moon = await MoonScene.create({
        container: "viewer",
        token: token(),
        grid: data.grid,
        onPick: (lon, lat) => setPending(lon, lat),
        onWalkMove: () => undefined,
        onStatus: (m) => toast(m, 6000),
      });
      moon.addSiteMarkers(allPlaces());
      const sp = subpointsAt(data.table, store.s.time);
      if (sp) moon.setSky(sunVectorKm(sp), earthVectorKm(sp));
      return moon;
    } catch (e) {
      toast(`Orbit view unavailable: ${(e as Error).message}`, 7000);
      $("viewer").classList.add("hidden");
      return null;
    }
  }

  function setPending(lon: number, lat: number, place?: Place): void {
    pending = { lon, lat, place };
    const known = place ?? allPlaces().find((p) => Math.abs(p.lat - lat) < 0.01 && Math.abs(((p.lon - lon + 540) % 360) - 180) < 0.05);
    pending.place = known;
    $("pickLabel").textContent = `${known ? known.short + " · " : ""}${fmtLat(lat)} · ${fmtLon(lon)}`;
    ($("btnLand") as HTMLButtonElement).disabled = false;
    const p: Place = known ?? { name: `Point ${fmtLat(lat)}, ${fmtLon(lon)}`, short: "Landing point", lat, lon, kind: "custom" };
    const now = skyNow(data, p, store.s.time);
    const a = analyse(data, p, Math.floor(store.s.time / 3600) * 3600, 30);
    const terr = patches.has(p.id ?? "") || p.id === "im1" || p.id === "im2" ? "NASA LOLA (precomputed)" : p.lat <= -80 && data.grid ? "NASA LOLA 400 m (coarse)" : "no terrain model — smooth sphere";
    const pv = $("preview");
    pv.innerHTML = `<div class="eyebrow">Landing preview</div><h3>${known ? known.name : "Selected point"}</h3>
      <div class="mono dim">${fmtLat(lat)} · ${fmtLon(lon)}</div>
      <div class="pv-grid">
        <div><label>Sun now</label><b>${now ? (now.sun.el >= 0 ? "+" : "") + now.sun.el.toFixed(2) + "°" : "—"}</b></div>
        <div><label>Earth now</label><b>${now ? (now.earth.el >= 0 ? "+" : "") + now.earth.el.toFixed(2) + "°" : "—"}</b></div>
        <div><label>Sunlit · 30 d</label><b>${a ? a.mReal.sunlitPct.toFixed(0) + "%" : "—"}</b></div>
        <div><label>Earth · 30 d</label><b>${a ? a.mReal.earthPct.toFixed(0) + "%" : "—"}</b></div>
      </div>
      <p class="dim small">Terrain: ${terr}. ${a?.status === "geometric" ? "Horizon is geometric only (smooth Moon)." : "Horizon from LOLA terrain."}</p>`;
    pv.classList.remove("hidden");
  }

  async function goOrbit(): Promise<void> {
    if (busy || store.s.mode !== "surface") return;
    if (world.inside) await exitControl();
    busy = true;
    instrument.close();
    scanner.hide();
    planner.hide();
    const p = world.player.pos.clone();
    const yaw = world.player.yaw;
    caption("Ascent · cinematic, not flight dynamics", 3000);
    const lp = world.outpost ? world.outpost.lander : { x: 18, z: -18 };
    const start = world.camera.position.clone();
    const gy = world.groundAt(lp.x, lp.z);
    await world.cinematic(3200, (u, cam) => {
      const e = u * u * (3 - 2 * u);
      const climb = Math.pow(u, 2.2) * 2600;
      cam.position.set(start.x + (lp.x + 40 - start.x) * e, start.y + (gy + 25 - start.y) * e + climb, start.z + (lp.z + 40 - start.z) * e + climb * 0.3);
      cam.lookAt(p.x + (lp.x - p.x) * e, gy + 5 - u * 40, p.z + (lp.z - p.z) * e);
    }, false);
    void yaw;
    await fade(true, 400);
    const m = await ensureMoon();
    if (!m) {
      await fade(false, 300);
      world.player.place(world.player.pos.x, world.player.pos.z, world.player.yaw);
      busy = false;
      return;
    }
    world.stop();
    $("surface").classList.add("hidden");
    $("viewer").classList.remove("hidden");
    store.set({ mode: "orbit" });
    updateReadout(store.s);
    await fade(false, 400);
    await m.ascendFrom(live.lon, live.lat);
    campaign.emit({ type: "orbit" });
    busy = false;
  }

  async function landAt(lon: number, lat: number, place?: Place): Promise<void> {
    if (busy) return;
    busy = true;
    $("preview").classList.add("hidden");
    const target: Place = place ?? { name: `Landing point ${fmtLat(lat)}, ${fmtLon(lon)}`, short: "Landing point", lat, lon, kind: "custom" };
    caption("Descent · cinematic, not flight dynamics", 3000);
    if (moon) await moon.approach(lon, lat);
    await fade(true, 350);
    // terrain for the new site
    let patch: SurfacePatch | null = null;
    const id = target.id ?? "";
    try {
      if (patches.has(id)) patch = patches.get(id) as SurfacePatch;
      else if (id === "im1" || id === "im2") {
        patch = await loadPatch(id);
        patches.set(id, patch);
      }
    } catch {
      patch = null;
    }
    if (!patch && lat <= -80 && data.grid) patch = patchFromGrid(data.grid, lon, lat);
    if (!patch) patch = smoothPatch(lon, lat);
    const atOutpost = id === "outpost" || id === "survey";
    world.setSite(atOutpost ? (patches.get("outpost") as SurfacePatch) : patch, { outpost: atOutpost, survey, spawn: id === "survey" ? spawnAtSurvey() : undefined });
    store.set({ mode: "surface", here: target });
    renderMission();
    live = { lon, lat };
    updateSky(store.s);
    if (moon) moon.pause(true);
    $("viewer").classList.add("hidden");
    $("surface").classList.remove("hidden");
    world.start();
    // descent: from ~1.4 km up down to eye height
    const pl = world.player;
    const end = { x: pl.pos.x, y: pl.pos.y + 1.62, z: pl.pos.z };
    const fwd = { x: Math.sin(pl.yaw), z: -Math.cos(pl.yaw) };
    void fade(false, 500);
    await world.cinematic(4200, (u, cam) => {
      const e = 1 - Math.pow(1 - u, 3);
      const h = (1 - e) * 1400;
      cam.position.set(end.x - fwd.x * (1 - e) * 500, end.y + h, end.z - fwd.z * (1 - e) * 500);
      const look = { x: end.x + fwd.x * 30, y: end.y - 2 + e * 1.5, z: end.z + fwd.z * 30 };
      cam.lookAt(look.x, look.y, look.z);
    }, false);
    $("roMode").textContent = modeLabel();
    toast(`Landed · ${patch.label}`, 5000);
    campaign.emit({ type: "land" });
    busy = false;
  }
  function spawnAtSurvey(): { x: number; z: number; yaw: number } {
    const [sx, sz] = lonLatToScene(patches.get("outpost") as SurfacePatch, survey.lon, survey.lat);
    return { x: sx + 3, z: sz + 3, yaw: Math.atan2(-sx, sz) };
  }

  // ---------- HUD wiring ----------
  $("orbitSites").innerHTML = "";
  for (const p of allPlaces()) {
    const b = document.createElement("button");
    b.className = "pill small";
    b.textContent = p.short;
    b.addEventListener("click", () => {
      moon?.showPick(p.lon, p.lat);
      setPending(p.lon, p.lat, p);
    });
    $("orbitSites").appendChild(b);
  }
  $("btnLand").addEventListener("click", () => {
    if (pending) void landAt(pending.lon, pending.lat, pending.place);
  });
  $("btnOrbit").addEventListener("click", () => {
    if (store.s.mode === "surface") void goOrbit();
    else if (pending) void landAt(pending.lon, pending.lat, pending.place);
    else void landAt(store.s.here.lon, store.s.here.lat, store.s.here);
  });
  $("btnScan").addEventListener("click", () => scanner.toggle());
  $("btnView").addEventListener("click", () => toggleView());
  $("btnMissions").addEventListener("click", () => {
    if (!campaign.active) campaign.start(firstOpenMission());
    else $("mission").classList.toggle("collapsed");
  });
  const firstOpenMission = (): number => Math.max(0, MISSIONS.findIndex((m) => !campaign.done.has(m.id)));
  $("scOpenPlanner").addEventListener("click", () => {
    store.set({ a: store.s.here, plannerIndex: 0, landing: Math.floor(store.s.time / 86400) * 86400 });
    planner.show("compare");
  });
  $("btnPlanner").addEventListener("click", () => openControl());
  $("plClose").addEventListener("click", () => document.body.classList.remove("console"));
  $("btnSettings").addEventListener("click", () => $("settings").classList.toggle("hidden"));
  $("setToken").addEventListener("click", () => {
    const dlg = $("tokenDlg") as HTMLDialogElement;
    dlg.addEventListener("close", () => {
      const v = ($("tokenIn") as HTMLInputElement).value.trim();
      if (dlg.returnValue === "save" && v) {
        try { localStorage.setItem(TOKEN_KEY, v); } catch { /* storage blocked */ }
        toast("Token saved in this browser only. It is used the next time the orbit globe loads (reload the page).", 6000);
      }
    }, { once: true });
    if (document.pointerLockElement) document.exitPointerLock();
    dlg.showModal();
  });
  ($("setReal") as HTMLInputElement).addEventListener("change", (e) => {
    world.realisticDark = (e.target as HTMLInputElement).checked;
    updateSky(store.s);
  });
  ($("setBob") as HTMLInputElement).addEventListener("change", (e) => (world.headBob = (e.target as HTMLInputElement).checked));
  ($("setSfx") as HTMLInputElement).addEventListener("change", (e) => sfx.setSfx((e.target as HTMLInputElement).checked));
  ($("setDetail") as HTMLInputElement).addEventListener("change", (e) => (shared.detail.value = (e.target as HTMLInputElement).checked ? 1 : 0));
  ($("setExp") as HTMLInputElement).addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    world.renderer.toneMappingExposure = v;
    $("expOut").textContent = v.toFixed(2);
  });
  function toggleView(): void {
    if (store.s.mode !== "surface") return;
    const tp = world.toggleView();
    $("crosshair").classList.toggle("hidden", tp || !document.pointerLockElement);
    toast(tp ? "Third-person view" : "First-person view — look down to see your suit", 2000);
  }

  store.on((s, ch) => {
    if (ch.has("time")) {
      updateSky(s);
      instrument.render(s);
    }
    if (world.inside) refreshScreens();
    updateReadout(s);
    scanner.render(s);
    if (planner.isOpen() && (ch.has("a") || ch.has("b") || ch.has("landing") || ch.has("slipDays") || ch.has("windowDays") || ch.has("terrain") || ch.has("plannerIndex"))) planner.render(s);
    if (ch.has("a") || ch.has("b")) {
      polarMap.draw(s);
      renderMissionBar();
    }
    if (ch.has("slipDays")) campaign.emit({ type: "slip", days: s.slipDays });
  });

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.closest?.("input, select, textarea, dialog")) return;
    if ($("intro").classList.contains("hidden") === false) return;
    if (e.code === "KeyM") scanner.toggle();
    else if (e.code === "KeyO") $("btnOrbit").click();
    else if (e.code === "KeyP") (planner.isOpen() ? (planner.hide(), document.body.classList.remove("console")) : openControl());
    else if (e.code === "KeyV") toggleView();
    else if (e.code === "Escape") {
      if (planner.isOpen()) { planner.hide(); document.body.classList.remove("console"); }
      else if (instrument.isOpen()) instrument.close();
      $("settings").classList.add("hidden");
    }
  });

  window.addEventListener("planner-tab", (ev) => {
    const prof = data.profiles.get("outpost");
    const op = patches.get("outpost");
    if ((ev as CustomEvent).detail === "reality" && skyCheck) void renderReality(data, skyCheck, data.grid, op && prof ? { patch: op, profile: prof } : null);
  });
  void runSkyCheck(data).then((r) => {
    skyCheck = r;
    scanner.render(store.s);
  });

  // ---------- touch controls ----------
  const touch = matchMedia("(pointer: coarse)").matches;
  $("prompt").addEventListener("click", () => world.useCurrent());
  if (touch) {
    $("stick").classList.remove("hidden");
    $("btnJump").classList.remove("hidden");
    $("btnJump").addEventListener("pointerdown", (e) => { e.preventDefault(); world.player.jump(); });
    const stick = $("stick"), knob = $("stickKnob");
    let id = -1;
    const move = (e: PointerEvent): void => {
      const r = stick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
      world.setStick(dx, -dy);
    };
    stick.addEventListener("pointerdown", (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); e.stopPropagation(); });
    stick.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
    const end = (): void => { id = -1; knob.style.transform = ""; world.setStick(0, 0); };
    stick.addEventListener("pointerup", end);
    stick.addEventListener("pointercancel", end);
  }

  // ---------- Earth marker (always findable) ----------
  let earthState = "";
  let sunHidden = "";
  const refreshEarthState = (): void => {
    const a = analyse(data, store.s.here, windowT0, 30);
    if (!a) { earthState = ""; sunHidden = ""; return; }
    const i = Math.max(0, Math.min(a.track.n - 1, Math.round((store.s.time - a.t0) / a.track.stepS)));
    const sEl = a.track.sunEl[i] as number, sHz = a.real.sunHorizon[i] as number;
    sunHidden = a.real.sunLit[i] === 0 && sEl > a.smoothDeg ? `Sun · hidden ${(sHz - sEl).toFixed(1)}° below the ridge` : "";
    const up = a.real.earthUp[i] === 1;
    const lit = Math.round(world.sky.earthLitFraction() * 100);
    earthState = up ? `Earth · ${lit}% lit` : (a.track.earthEl[i] as number) > a.smoothDeg ? "Earth · behind terrain" : "Earth · below horizon";
  };
  world.afterFrame = () => {
    const tag = $("earthTag");
    if (store.s.mode !== "surface" || !earthState || world.inside) { tag.classList.add("hidden"); $("sunTag").classList.add("hidden"); return; }
    const p = world.projectDir(world.sky.earthDir);
    const W = window.innerWidth, H = window.innerHeight;
    const on = !p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H;
    let x = p.x + 10, y = p.y - 12;
    if (!on) {
      const cx = W / 2, cy = H / 2;
      let dx = p.x - cx, dy = p.y - cy;
      if (p.behind) { dx = -dx; dy = -dy; }
      const k = Math.min((W / 2 - 90) / Math.abs(dx || 1e-6), (H / 2 - 70) / Math.abs(dy || 1e-6));
      x = cx + dx * k - 40; y = cy + dy * k - 12;
    }
    tag.classList.remove("hidden");
    tag.classList.toggle("edge", !on);
    tag.classList.toggle("blocked", !earthState.includes("lit"));
    $("earthTagText").textContent = on ? earthState : `${dxArrow(p, W)} ${earthState}`;
    tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    const st = $("sunTag");
    const sp = world.projectDir(world.sky.sunDir);
    const sOn = !!sunHidden && !sp.behind && sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < H;
    st.classList.toggle("hidden", !sOn);
    if (sOn) {
      $("sunTagText").textContent = sunHidden;
      st.style.transform = `translate(${Math.round(sp.x - 9)}px, ${Math.round(sp.y - 11)}px)`;
    }
  };
  const dxArrow = (p: { x: number; behind: boolean }, W: number): string => ((p.behind ? W - p.x : p.x) < W / 2 ? "◂" : "▸");
  store.on((_s, ch) => {
    if (ch.has("time") || ch.has("here")) refreshEarthState();
  });
  refreshEarthState();

  // ---------- opening ----------
  updateSky(store.s);
  updateReadout(store.s);
  $("roCoords").textContent = `${fmtLat(outpost.lat)} ${fmtLon(outpost.lon)}`;
  world.start();
  $("boot").classList.add("done");
  $("introBrief").textContent = `You are part of a lunar research mission. Your task is to investigate where future lunar landers can receive sunlight and keep in contact with Earth.`;
  $("introFine").textContent = `The outpost is fictional. Its site — ${fmtLat(outpost.lat)}, ${fmtLon(outpost.lon)}, on the rim of Shackleton crater — was chosen by code from NASA's illumination maps. Terrain: NASA LOLA. Sun & Earth: NASA/JPL Horizons. Mission clock: ${fmtUtc(store.s.time)} UTC.`;
  const flyover = (): void => {
    const R = 150, gy = groundY(world.patch as SurfacePatch, 0, 0);
    void world.cinematic(90_000, (u, cam) => {
      const a = -1.2 + u * Math.PI * 1.4;
      cam.position.set(Math.sin(a) * R, gy + 34 + Math.sin(u * 6) * 4, -Math.cos(a) * R);
      cam.lookAt(-4, gy + 2, 2);
    }, false);
  };
  const begin = async (mode: "mission" | "free"): Promise<void> => {
    $("intro").classList.add("leaving");
    const start = world.camera.position.clone();
    const q0 = world.camera.quaternion.clone();
    world.skipCinematic();
    const pl = world.player;
    const end = { x: pl.pos.x + Math.sin(pl.yaw) * 0.12, y: pl.pos.y + 1.62, z: pl.pos.z - Math.cos(pl.yaw) * 0.12 };
    const tmp = world.camera.clone();
    tmp.position.set(end.x, end.y, end.z);
    tmp.rotation.order = "YXZ";
    tmp.rotation.set(pl.pitch, -pl.yaw, 0);
    const q1 = tmp.quaternion.clone();
    await world.cinematic(2200, (u, cam) => {
      const e = u * u * (3 - 2 * u);
      cam.position.set(start.x + (end.x - start.x) * e, start.y + (end.y - start.y) * e, start.z + (end.z - start.z) * e);
      cam.quaternion.copy(q0).slerp(q1, e);
    }, false);
    $("intro").classList.add("hidden");
    $("intro").classList.remove("leaving");
    document.body.classList.remove("intro-on");
    if (mode === "mission") {
      campaign.start(0);
      caption("Mission 01 · First Light", 2600);
    }
    $("tutorial").classList.remove("hidden");
    window.setTimeout(() => $("tutorial").classList.add("fade"), 16000);
  };
  $("introBegin").addEventListener("click", () => void begin("mission"));
  $("introFree").addEventListener("click", () => void begin("free"));
  $("introSkip").addEventListener("click", () => void begin("mission"));

  (window as unknown as { onedegree: unknown }).onedegree = { enterControl, store, data, world, scanner, planner, instrument, campaign, get moon() { return moon; }, windowT0, interact, goOrbit, landAt };
  if (url.demo) {
    $("intro").classList.add("hidden");
    window.setTimeout(() => void runDemo({ store, scanner, planner, world, instrument, campaign, caption, data, windowT0, outpost, survey, interact }), 600);
  } else {
    document.body.classList.add("intro-on");
    $("intro").classList.remove("hidden");
    flyover();
  }
  $("btnDemo").addEventListener("click", () => void runDemo({ store, scanner, planner, world, instrument, campaign, caption, data, windowT0, outpost, survey, interact }));

  // token dialog: offered only from orbit, never required
  void token;
}

void boot();
