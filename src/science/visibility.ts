// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * What the skyline lets through: Sun disc and Earth line of sight over time,
 * and the mission metrics derived from them.
 *
 * Definitions (shown in the UI next to every number):
 *  - Sun disc fraction: share of the Sun's disc (radius 0.2666 deg) above the
 *    skyline, treating the skyline as level across the disc's width.
 *  - "Sunlit": at least half the disc visible (its centre clears the skyline).
 *    This is geometry, not power: panel pointing, dust and efficiency are not modelled.
 *  - "Earth in view": Earth's centre above the skyline — geometric line of sight to
 *    Earth's centre, NOT a working radio link. (NASA's polar Earth-visibility maps
 *    count any part of the disc, a slightly more generous rule.)
 *  - Smooth Moon: the same Sun/Earth positions against a perfectly smooth sphere
 *    (horizon = geometric dip for the eye height). The gap between the two is the
 *    "one degree" that terrain decides.
 */

import { SUN_RADIUS_DEG, type SkyTrack } from "./sky";
import { horizonAt } from "./terrain";

/** Fraction of a disc of angular radius r whose centre is at `el`, above a level line at `h`. */
export function discFractionAbove(el: number, h: number, r: number): number {
  const x = (h - el) / r; // line position relative to the centre, in radii
  if (x <= -1) return 1;
  if (x >= 1) return 0;
  return (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

export interface Visibility {
  t0: number;
  stepS: number;
  n: number;
  sunFrac: Float32Array;
  sunLit: Uint8Array;
  earthUp: Uint8Array;
  sunHorizon: Float32Array;
  earthHorizon: Float32Array;
}

/** horizon === null -> smooth Moon at `smoothDeg`. */
export function visibility(track: SkyTrack, horizon: ArrayLike<number> | null, smoothDeg: number): Visibility {
  const n = track.n;
  const v: Visibility = {
    t0: track.t0,
    stepS: track.stepS,
    n,
    sunFrac: new Float32Array(n),
    sunLit: new Uint8Array(n),
    earthUp: new Uint8Array(n),
    sunHorizon: new Float32Array(n),
    earthHorizon: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const sEl = track.sunEl[i] as number;
    const eEl = track.earthEl[i] as number;
    const hs = horizon ? horizonAt(horizon, track.sunAz[i] as number) : smoothDeg;
    const he = horizon ? horizonAt(horizon, track.earthAz[i] as number) : smoothDeg;
    v.sunHorizon[i] = hs;
    v.earthHorizon[i] = he;
    const frac = Number.isNaN(sEl) ? 0 : discFractionAbove(sEl, hs, SUN_RADIUS_DEG);
    v.sunFrac[i] = frac;
    v.sunLit[i] = frac >= 0.5 ? 1 : 0;
    v.earthUp[i] = !Number.isNaN(eEl) && eEl > he ? 1 : 0;
  }
  return v;
}

export interface Run {
  startIndex: number;
  length: number;
  /** True when the run touches the window's start or end, so it may be longer. */
  open: boolean;
}

export function longestRun(flags: Uint8Array, value: 0 | 1): Run {
  let best: Run = { startIndex: -1, length: 0, open: false };
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i] === value;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const len = i - start;
      if (len > best.length) best = { startIndex: start, length: len, open: start === 0 || i === flags.length };
      start = -1;
    }
  }
  return best;
}

/** First index >= from where flags changes from its value at `from`; -1 if never. */
export function nextChange(flags: Uint8Array, from: number): number {
  const v = flags[from];
  for (let i = from + 1; i < flags.length; i++) if (flags[i] !== v) return i;
  return -1;
}

export interface Metrics {
  windowHours: number;
  stepMinutes: number;
  sunlitPct: number;
  earthPct: number;
  bothPct: number;
  meanDiscPct: number;
  longestDarkH: number;
  longestDarkOpen: boolean;
  longestBlackoutH: number;
  longestBlackoutOpen: boolean;
}

export function metrics(v: Visibility): Metrics {
  let lit = 0;
  let earth = 0;
  let both = 0;
  let disc = 0;
  for (let i = 0; i < v.n; i++) {
    lit += v.sunLit[i] as number;
    earth += v.earthUp[i] as number;
    both += (v.sunLit[i] as number) & (v.earthUp[i] as number);
    disc += v.sunFrac[i] as number;
  }
  const dark = longestRun(v.sunLit, 0);
  const blackout = longestRun(v.earthUp, 0);
  const h = v.stepS / 3600;
  return {
    windowHours: (v.n - 1) * h,
    stepMinutes: v.stepS / 60,
    sunlitPct: (100 * lit) / v.n,
    earthPct: (100 * earth) / v.n,
    bothPct: (100 * both) / v.n,
    meanDiscPct: (100 * disc) / v.n,
    longestDarkH: dark.length * h,
    longestDarkOpen: dark.open,
    longestBlackoutH: blackout.length * h,
    longestBlackoutOpen: blackout.open,
  };
}
