import type { Place } from "./data";

export type Mode = "surface" | "orbit";
export type HorizonMode = "real" | "smooth";

export interface State {
  /** Where the explorer is standing (or last landed). */
  here: Place;
  /** The instant shown everywhere: 3D lighting, scanner, readout (unix s, UTC). */
  time: number;
  terrain: HorizonMode;
  mode: Mode;
  /** Planner */
  a: Place;
  b: Place;
  landing: number;
  slipDays: number;
  windowDays: number;
  plannerIndex: number;
}

type Listener = (s: State, changed: Set<keyof State>) => void;

export class Store {
  private listeners: Listener[] = [];
  constructor(public s: State) {}
  on(l: Listener): void {
    this.listeners.push(l);
  }
  set(patch: Partial<State>): void {
    const changed = new Set<keyof State>();
    for (const k of Object.keys(patch) as (keyof State)[]) {
      if (this.s[k] !== patch[k]) changed.add(k);
    }
    if (!changed.size) return;
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l(this.s, changed);
  }
}

/** Shareable state in the URL: ?lat=..&lon=..&t=.. */
export function readUrl(): { lat?: number; lon?: number; t?: number; demo?: boolean } {
  const q = new URLSearchParams(location.search);
  const num = (k: string): number | undefined => {
    const v = q.get(k);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return { lat: num("lat"), lon: num("lon"), t: num("t"), demo: q.has("demo") };
}

export function writeUrl(s: State): void {
  const q = new URLSearchParams(location.search);
  q.set("lat", s.here.lat.toFixed(4));
  q.set("lon", s.here.lon.toFixed(4));
  q.set("t", String(Math.round(s.time)));
  q.delete("demo");
  history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
}
