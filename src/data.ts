// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Loading the shipped NASA-derived data, and one cached analysis per site/window.
 * Everything the panels draw comes from `analyse()`, so the scanner, planner,
 * timeline and Reality Check can never disagree with each other.
 */

import { skyAt, skyTrack, tableCovers, type SkyAt, type SkyTrack, type SubpointTable } from "./science/sky";
import { computeSkyline, skylineFromProfile, smoothHorizonDeg, toPolarXY, sampleGrid, type PrecomputedProfile, type Skyline, type TerrainGrid } from "./science/terrain";
import { metrics, visibility, type Metrics, type Visibility } from "./science/visibility";

export interface Place {
  id?: string;
  name: string;
  short: string;
  lat: number;
  lon: number;
  kind: string;
  source?: string;
  event?: string;
  event_date?: string;
}

export interface SitesFile {
  sites: Place[];
  regions: { source: string; url: string; names: string[] };
  reference: Place;
}

export interface Data {
  table: SubpointTable;
  sites: SitesFile;
  profiles: Map<string, PrecomputedProfile>;
  grid: TerrainGrid | null;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function loadCore(progress: (s: string) => void): Promise<Data> {
  progress("Loading NASA/JPL Horizons ephemeris…");
  const [table, sites] = await Promise.all([
    json<SubpointTable>("/data/ephemeris/moon_subpoints_hourly.json"),
    json<SitesFile>("/data/sites.json"),
  ]);
  progress("Loading LRO/LOLA terrain skylines…");
  const profiles = new Map<string, PrecomputedProfile>();
  await Promise.all(
    sites.sites.map(async (s) => {
      if (!s.id) return;
      try {
        profiles.set(s.id, await json<PrecomputedProfile>(`/data/horizons/${s.id}.json`));
      } catch {
        /* a site without a profile falls back to the live grid, then to geometric-only */
      }
    }),
  );
  return { table, sites, profiles, grid: null };
}

export async function loadGrid(): Promise<TerrainGrid> {
  const meta = await json<{ width: number; height: number; x0: number; y0: number; px_m: number }>("/data/terrain/south_pole_400m.json");
  const r = await fetch("/data/terrain/south_pole_400m.bin");
  if (!r.ok) throw new Error(`terrain grid: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return { width: meta.width, height: meta.height, x0: meta.x0, y0: meta.y0, px: meta.px_m, data: new Int16Array(buf) };
}

export type TerrainStatus = "precomputed" | "live400" | "geometric";

export interface Analysis {
  place: Place;
  t0: number;
  days: number;
  skyline: Skyline | null;
  status: TerrainStatus;
  track: SkyTrack;
  real: Visibility;
  smooth: Visibility;
  mReal: Metrics;
  mSmooth: Metrics;
  smoothDeg: number;
}

export const EYE_M = 2;
export const STEP_S = 1800;

const skylineCache = new Map<string, { skyline: Skyline | null; status: TerrainStatus }>();
const analysisCache = new Map<string, Analysis>();

export function placeKey(p: Place): string {
  return p.id ?? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

export function skylineFor(data: Data, p: Place): { skyline: Skyline | null; status: TerrainStatus } {
  const key = placeKey(p);
  const hit = skylineCache.get(key);
  if (hit) return hit;
  let out: { skyline: Skyline | null; status: TerrainStatus } = { skyline: null, status: "geometric" };
  const prof = p.id ? data.profiles.get(p.id) : undefined;
  if (prof) out = { skyline: skylineFromProfile(prof), status: "precomputed" };
  else if (data.grid && p.lat <= -79.5) {
    const s = computeSkyline(data.grid, p.lon, p.lat, EYE_M);
    if (s) out = { skyline: s, status: "live400" };
  }
  skylineCache.set(key, out);
  return out;
}

export function analyse(data: Data, p: Place, t0: number, days: number): Analysis | null {
  if (!tableCovers(data.table, t0)) return null;
  const key = `${placeKey(p)}|${t0}|${days}`;
  const hit = analysisCache.get(key);
  if (hit) return hit;
  const { skyline, status } = skylineFor(data, p);
  const last = data.table.start_unix + (data.table.n - 1) * data.table.step_s;
  const hours = Math.min(days * 24, (last - t0) / 3600);
  const track = skyTrack(data.table, t0, hours, STEP_S, p.lon, p.lat, 0);
  const smoothDeg = smoothHorizonDeg(EYE_M);
  const real = visibility(track, skyline ? skyline.horizon : null, smoothDeg);
  const smooth = visibility(track, null, smoothDeg);
  const a: Analysis = { place: p, t0, days, skyline, status, track, real, smooth, mReal: metrics(real), mSmooth: metrics(smooth), smoothDeg };
  if (analysisCache.size > 40) analysisCache.clear();
  analysisCache.set(key, a);
  return a;
}

export function skyNow(data: Data, p: Place, unix: number): SkyAt | null {
  return skyAt(data.table, unix, p.lon, p.lat, 0);
}

export function groundHeightAt(data: Data, p: Place): number | null {
  const prof = p.id ? data.profiles.get(p.id) : undefined;
  if (prof) return prof.ground_m;
  if (!data.grid) return null;
  const [x, y] = toPolarXY(p.lon, p.lat);
  const h = sampleGrid(data.grid, x, y);
  return Number.isNaN(h) ? null : h;
}

export function tableRange(t: SubpointTable): [number, number] {
  return [t.start_unix, t.start_unix + (t.n - 1) * t.step_s];
}
