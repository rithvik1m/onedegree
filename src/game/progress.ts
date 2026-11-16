// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Versioned save game in localStorage (this browser only — no cloud sync).
 * Measurements are stored with their place, time and model provenance so a reload never
 * silently re-labels an old result. Corrupted saves are moved aside, not thrown away.
 */

export const SAVE_KEY = "onedegree.save";
export const SAVE_VERSION = 1;

export interface Observation {
  id: string;
  siteId: string;
  lon: number;
  lat: number;
  unix: number;
  kind: string;
  summary: string;
  provenance: string;
}

export interface SaveData {
  v: number;
  savedAt: string;
  main: { done: string[]; active: { id: string; step: number } | null };
  side: Record<string, { state: "active" | "done" | "abandoned"; step: number; data?: Record<string, unknown> }>;
  activeSide: string | null;
  discovered: string[];
  notes: { k: "q" | "obs" | "pred" | "concl"; t: string }[];
  observations: Observation[];
  prediction: string | null;
  /** last safe on-foot position (region key + scene metres) */
  location: { siteId: string; x: number; z: number; yaw: number } | null;
  /** where the spacecraft is parked (region key + scene metres) */
  craft: { region: string; x: number; z: number; yaw: number } | null;
  destination: { id: string; lon: number; lat: number; name: string } | null;
  custom?: { lon: number; lat: number } | null;
  controls: { speed: number; sens: number; bob: boolean; sfx: boolean };
}

export function emptySave(): SaveData {
  return {
    v: SAVE_VERSION, savedAt: new Date().toISOString(),
    main: { done: [], active: null }, side: {}, activeSide: null,
    discovered: ["outpost"], notes: [], observations: [], prediction: null,
    location: null, craft: null, destination: null, controls: { speed: 1, sens: 1, bob: true, sfx: false },
  };
}

/** Upgrade older save shapes here as the schema evolves. */
function migrate(d: Record<string, unknown>): SaveData | null {
  const v = Number(d.v);
  if (!Number.isFinite(v)) return null;
  if (v > SAVE_VERSION) return null; // from a newer build: do not guess
  // v1 is current; fill any missing fields with defaults
  return { ...emptySave(), ...(d as Partial<SaveData>), v: SAVE_VERSION } as SaveData;
}

export function loadSave(): { data: SaveData | null; note: string } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return { data: null, note: "Browser storage is blocked — progress cannot be saved here." };
  }
  if (!raw) return { data: null, note: "" };
  try {
    const d = migrate(JSON.parse(raw) as Record<string, unknown>);
    if (!d) throw new Error("unreadable save");
    return { data: d, note: "" };
  } catch {
    try {
      localStorage.setItem(`${SAVE_KEY}.corrupt.${Date.now()}`, raw);
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    return { data: null, note: "Your saved progress was unreadable; it was set aside and a new exploration started." };
  }
}

export function writeSave(d: SaveData): boolean {
  try {
    d.savedAt = new Date().toISOString();
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function exportSave(d: SaveData): void {
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `onedegree-save-${d.savedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importSave(file: File): Promise<SaveData | null> {
  try {
    return migrate(JSON.parse(await file.text()) as Record<string, unknown>);
  } catch {
    return null;
  }
}
