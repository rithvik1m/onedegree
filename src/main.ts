import "./styles.css";
import { loadCore, loadGrid, skyNow, type Data, type Place } from "./data";
import { MoonScene } from "./cesium/moon";
import { earthVectorKm, subpointsAt, sunVectorKm } from "./science/sky";
import { Store, readUrl, writeUrl, type State } from "./state";
import { $, fmtLat, fmtLon, fmtUtc } from "./ui/format";
import { Planner, Scanner } from "./ui/panels";
import { renderReality, runSkyCheck, type SkyCheck } from "./ui/reality";
import { renderAbout } from "./ui/about";
import { runDemo } from "./demo";

const TOKEN_KEY = "onedegree.ionToken";

function toast(msg: string, ms = 3800): void {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  window.clearTimeout((toast as unknown as { h?: number }).h);
  (toast as unknown as { h?: number }).h = window.setTimeout(() => t.classList.remove("show"), ms);
}

async function askToken(): Promise<string | null> {
  const env = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim();
  if (env) return env;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
  if (saved !== null) return saved || null;
  return null;
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
  const athena = sites.find((s) => s.id === "im2") as Place;
  const odysseus = sites.find((s) => s.id === "im1") as Place;
  const url = readUrl();
  const startPlace: Place =
    url.lat !== undefined && url.lon !== undefined
      ? { name: `Point ${fmtLat(url.lat)}, ${fmtLon(url.lon)}`, short: "Shared point", lat: url.lat, lon: url.lon, kind: "custom" }
      : athena;
  const landing = Date.parse("2025-03-06T00:00:00Z") / 1000;
  const startTime = url.t ?? Date.parse("2025-03-06T12:00:00Z") / 1000;

  const store = new Store({
    here: startPlace,
    time: startTime,
    terrain: "real",
    mode: "surface",
    a: athena,
    b: odysseus,
    landing,
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

  // 3D Moon
  progress("Building the Moon…");
  let moon: MoonScene | null = null;
  const token = await askToken();
  const typedCesium = (window as unknown as { Cesium?: unknown }).Cesium;
  if (typedCesium) {
    try {
      moon = await MoonScene.create({
        container: "viewer",
        token,
        grid: data.grid,
        onPick: (lon, lat) => {
          pending = { lon, lat };
          $("pickLabel").textContent = `${fmtLat(lat)} · ${fmtLon(lon)}`;
          ($("btnLand") as HTMLButtonElement).disabled = false;
        },
        onWalkMove: (lon, lat) => {
          walkMoved = { lon, lat };
        },
        onStatus: (m) => toast(m, 6000),
      });
      moon.addSiteMarkers([...sites, data.sites.reference]);
    } catch (e) {
      toast(`3D view unavailable: ${(e as Error).message}. The planner still works.`, 8000);
      moon = null;
    }
  } else {
    toast("3D library failed to load — the planner and scanner still work.", 8000);
  }

  let pending: { lon: number; lat: number } | null = null;
  let walkMoved: { lon: number; lat: number } | null = null;

  const updateSky = (s: State): void => {
    const sp = subpointsAt(data.table, s.time);
    if (moon && sp) moon.setSky(sunVectorKm(sp), earthVectorKm(sp));
  };
  const updateReadout = (s: State): void => {
    $("roSite").textContent = s.here.short ?? s.here.name;
    $("roCoords").textContent = `${fmtLat(s.here.lat)} ${fmtLon(s.here.lon)}`;
    $("roTime").textContent = fmtUtc(s.time);
    $("roMode").textContent = s.mode === "surface" ? (moon?.usingTiles ? "On foot · Cesium Moon" : "On foot · NASA imagery + LOLA") : "Orbit";
    $("btnOrbitLabel").textContent = s.mode === "surface" ? "Launch to orbit" : "Back to surface";
    $("orbitBar").classList.toggle("hidden", s.mode !== "orbit");
    $("hints").classList.toggle("hidden", s.mode !== "surface" || !moon);
  };

  store.on((s, ch) => {
    if (ch.has("time")) updateSky(s);
    updateReadout(s);
    scanner.render(s);
    if (planner.isOpen() && (ch.has("a") || ch.has("b") || ch.has("landing") || ch.has("slipDays") || ch.has("windowDays") || ch.has("terrain") || ch.has("plannerIndex"))) planner.render(s);
    if (ch.has("here") || ch.has("time")) writeUrl(s);
  });

  // Walking updates the shared position at most 4x a second.
  window.setInterval(() => {
    if (!walkMoved) return;
    const { lon, lat } = walkMoved;
    walkMoved = null;
    const cur = store.s.here;
    if (Math.abs(cur.lat - lat) < 1e-6 && Math.abs(cur.lon - lon) < 1e-6) return;
    const named = cur.kind !== "custom" && Math.abs(cur.lat - lat) < 0.002 && Math.abs(cur.lon - lon) < 0.02;
    store.set({ here: named ? { ...cur, lat, lon } : { name: `On foot near ${fmtLat(lat)}, ${fmtLon(lon)}`, short: "On foot", lat, lon, kind: "custom", id: undefined } });
  }, 250);

  // Orbit bar site chips
  $("orbitSites").innerHTML = "";
  for (const p of allPlaces()) {
    const b = document.createElement("button");
    b.className = "pill small";
    b.textContent = p.short;
    b.addEventListener("click", () => {
      pending = { lon: p.lon, lat: p.lat };
      moon?.showPick(p.lon, p.lat);
      $("pickLabel").textContent = `${p.short} · ${fmtLat(p.lat)} · ${fmtLon(p.lon)}`;
      ($("btnLand") as HTMLButtonElement).disabled = false;
    });
    $("orbitSites").appendChild(b);
  }

  const goOrbit = async (): Promise<void> => {
    if (!moon) return;
    store.set({ mode: "orbit" });
    caption("Ascent to orbit · cinematic visualisation, not flight dynamics", 3200);
    await moon.toOrbit(store.s.here.lon, store.s.here.lat, true);
  };
  const landAt = async (lon: number, lat: number, place?: Place): Promise<void> => {
    if (!moon) {
      store.set({ here: place ?? { name: `Point ${fmtLat(lat)}, ${fmtLon(lon)}`, short: "Custom", lat, lon, kind: "custom" } });
      return;
    }
    const known = place ?? allPlaces().find((p) => Math.abs(p.lat - lat) < 0.01 && Math.abs(((p.lon - lon + 540) % 360) - 180) < 0.05);
    caption("Descent · cinematic visualisation", 2600);
    await moon.land(lon, lat);
    store.set({ mode: "surface", here: known ?? { name: `Landing point ${fmtLat(lat)}, ${fmtLon(lon)}`, short: "Landing point", lat, lon, kind: "custom" } });
    $("hints").classList.remove("fade");
    window.setTimeout(() => $("hints").classList.add("fade"), 7000);
  };
  $("btnLand").addEventListener("click", () => {
    if (pending) void landAt(pending.lon, pending.lat);
  });
  $("btnOrbit").addEventListener("click", () => {
    if (store.s.mode === "surface") void goOrbit();
    else void landAt(store.s.here.lon, store.s.here.lat, store.s.here);
  });
  $("btnScan").addEventListener("click", () => scanner.toggle());
  $("scOpenPlanner").addEventListener("click", () => {
    store.set({ a: store.s.here, plannerIndex: 0, landing: Math.floor(store.s.time / 86400) * 86400 });
    planner.show("compare");
  });
  $("btnPlanner").addEventListener("click", () => planner.show("compare"));
  $("btnDemo").addEventListener("click", () => void runDemo({ store, scanner, planner, moon, caption, data }));

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.closest?.("input, select, textarea, dialog")) return;
    if (e.code === "KeyM") scanner.toggle();
    else if (e.code === "KeyO") $("btnOrbit").click();
    else if (e.code === "KeyP") (planner.isOpen() ? planner.hide() : planner.show("compare"));
    else if (e.code === "KeyV" && moon && store.s.mode === "surface") toast(moon.toggleView() ? "Third-person view" : "First-person view — look down to see your suit", 2200);
    else if (e.code === "Escape" && planner.isOpen()) planner.hide();
  });

  // Reality check runs in the background; its measured error feeds the badges.
  window.addEventListener("planner-tab", (ev) => {
    if ((ev as CustomEvent).detail === "reality" && skyCheck) void renderReality(data, skyCheck, data.grid);
  });
  void runSkyCheck(data).then((r) => {
    skyCheck = r;
    scanner.render(store.s);
  });

  // Token dialog, only offered once and never required.
  if (moon && !moon.usingTiles && token === null) {
    window.setTimeout(() => {
      const dlg = $("tokenDlg") as HTMLDialogElement;
      dlg.addEventListener("close", () => {
        const v = ($("tokenIn") as HTMLInputElement).value.trim();
        try {
          localStorage.setItem(TOKEN_KEY, dlg.returnValue === "save" ? v : "");
        } catch {
          /* ignore */
        }
        if (dlg.returnValue === "save" && v) location.reload();
      }, { once: true });
      if (!url.demo) dlg.showModal();
    }, 1500);
  }

  // Start on the surface at the start place.
  updateSky(store.s);
  updateReadout(store.s);
  if (moon) {
    await moon.land(startPlace.lon, startPlace.lat).catch(() => undefined);
    moon.startWalk(startPlace.lon, startPlace.lat, 0);
  }
  $("boot").classList.add("done");
  scanner.show();
  window.setTimeout(() => $("hints").classList.add("fade"), 9000);
  (window as unknown as { onedegree: unknown }).onedegree = { store, data, moon, scanner, planner, skyNow };
  if (url.demo) window.setTimeout(() => $("btnDemo").click(), 800);
}

let captionTimer = 0;
export function caption(text: string, ms = 3000): void {
  const c = $("caption");
  c.textContent = text;
  c.classList.add("show");
  window.clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => c.classList.remove("show"), ms);
}

void boot();
