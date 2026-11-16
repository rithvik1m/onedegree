// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Graphics settings (persisted). Rendering detail only — the science (Horizons × LOLA
 * skylines, the sun gate, every percentage) never reads these values.
 */

export type Preset = "low" | "balanced" | "high";
export type Shadows = "off" | "low" | "high";
export type Detail = "low" | "medium" | "high";
export type Lighting = "realistic" | "balanced" | "bright";

export interface Gfx {
  preset: Preset;
  /** metres: detailed props, rocks and labels beyond this are not drawn (terrain always is) */
  renderDist: number;
  shadows: Shadows;
  detail: Detail;
  /** multiplies the device pixel ratio (after the preset's cap) */
  resScale: number;
  fps: boolean;
  lighting: Lighting;
  /** let the renderer lower resolution automatically when frames get slow */
  adaptive: boolean;
}

export const PRESETS: Record<Preset, Omit<Gfx, "preset" | "fps" | "lighting" | "adaptive">> = {
  low: { renderDist: 150, shadows: "off", detail: "low", resScale: 0.8 },
  balanced: { renderDist: 350, shadows: "low", detail: "medium", resScale: 1 },
  high: { renderDist: 800, shadows: "high", detail: "high", resScale: 1 },
};

/** Device pixel ratio cap per preset (Retina screens double the pixel count). */
export const DPR_CAP: Record<Preset, number> = { low: 1, balanced: 1.25, high: 1.6 };
/**
 * Pixel budget (megapixels actually rendered). Measured on an 8 GB A18 Pro Mac: a 2560×1440
 * window (3.7 MP) ran outdoors at 44–51 fps with 33 ms frames every few frames; ~2 MP holds 60.
 */
export const PIXEL_BUDGET: Record<Preset, number> = { low: 1.2e6, balanced: 2.1e6, high: 3.7e6 };

/** Terrain mesh decimation per preset: [azimuth stride, far-ring stride]. Visual only. */
export const TERRAIN_LOD: Record<Preset, [number, number]> = { low: [2, 3], balanced: [2, 2], high: [1, 1] };

const KEY = "onedegree.gfx";

export function autoPreset(): Preset {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  if (coarse || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4) return "low";
  return "balanced";
}

export function loadGfx(): Gfx {
  const base = (p: Preset): Gfx => ({ preset: p, ...PRESETS[p], fps: false, lighting: "balanced", adaptive: true });
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base("balanced"), ...(JSON.parse(raw) as Partial<Gfx>) };
  } catch {
    /* storage blocked */
  }
  return base(autoPreset());
}

export function saveGfx(g: Gfx): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}
