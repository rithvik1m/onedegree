// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Optional activities as data. Every step names its site and target so the board, the
 * map and the waypoint arrow can all point to the same real place. Results are computed
 * by the science engine in main.ts — no step has a scripted outcome.
 */

export type SideEvent =
  | { type: "arrive"; siteId: string }
  | { type: "inst"; id: string }
  | { type: "record"; kind: string; placeId: string }
  | { type: "lostsignal" }
  | { type: "scan"; siteId: string; x: number; z: number; earthOk: boolean; sunHidden: boolean }
  | { type: "historic"; id: string }
  | { type: "scope" };

export type Category = "main" | "side" | "exploration" | "challenge";

export interface SideStep {
  text: string;
  site?: string; // where this step happens (site / region id)
  target?: string; // interactable id or "partner" or "point:<n>"
  done: (e: SideEvent, data: Record<string, unknown>) => boolean;
}

export interface SideQuest {
  id: string;
  cat: Category;
  title: string;
  where: string;
  brief: string;
  fiction?: string;
  steps: SideStep[];
}

export const SIDEQUESTS: SideQuest[] = [
  {
    id: "lostsignal",
    cat: "side",
    title: "Lost Signal",
    where: "earthlink",
    brief: "Robotic probe PROBE-7 stopped answering near EarthLink. Find out whether the land between it and Earth is to blame — and where it could talk again.",
    fiction: "PROBE-7 and its fault are fiction; the line-of-sight geometry is NASA data (Horizons × LOLA).",
    steps: [
      { text: "Travel to EarthLink Communications Station (Map → EarthLink)", done: (e) => e.type === "arrive" && e.siteId === "earthlink" },
      { text: "Go to PROBE-7 at LS-1 (follow the beam) and inspect it (E)", site: "earthlink", target: "lostsignal", done: (e) => e.type === "lostsignal" },
      { text: "Find a nearby spot where Earth IS in view: walk or drive, press H to scan", site: "earthlink", target: "partner", done: (e) => e.type === "scan" && e.siteId === "earthlink" && e.earthOk },
    ],
  },
  {
    id: "shadowhunter",
    cat: "side",
    title: "Shadow Hunter",
    where: "shadow",
    brief: "The Shadow Research Station sits beside near-permanent darkness. Measure both places and find out how a few hundred metres change the light.",
    steps: [
      { text: "Travel to the Shadow Research Station (Map → Shadow Station)", done: (e) => e.type === "arrive" && e.siteId === "shadow" },
      { text: "Measure sunlight at the Shadow Sensor and Record it", site: "shadow", target: "inst:solar:shadow", done: (e) => e.type === "record" && e.placeId === "shadow" },
      { text: "Go to SH-2 (follow the beam), measure, and Record", site: "shadow", target: "partner", done: (e) => e.type === "record" && e.placeId === "sh2" },
    ],
  },
  {
    id: "explorer",
    cat: "exploration",
    title: "Lunar Explorer",
    where: "outpost",
    brief: "Survey three real terrain features around the outpost — the Shackleton rim viewpoint, the ridge crest and the S-1 slope — with a quick scan (H) at each.",
    steps: [
      { text: "Quick-scan (H) at the 3 marked observation points (0/3)", site: "outpost", target: "point:next", done: (_e, d) => Number(d.count ?? 0) >= 3 },
    ],
  },
  {
    id: "heritage",
    cat: "exploration",
    title: "Heritage Explorer",
    where: "a11",
    brief: "Visit a documented Apollo landing site, read what happened there, and view the descent stage from outside NASA's recommended heritage boundary.",
    steps: [
      { text: "Land at an Apollo site (Map → Historic)", done: (e) => e.type === "historic" },
      { text: "Look through the observation scope at the boundary (E)", target: "scope", done: (e) => e.type === "scope" },
    ],
  },
  {
    id: "onedegree",
    cat: "challenge",
    title: "One-Degree Hunter",
    where: "outpost",
    brief: "Find a spot where the Sun is above a flat horizon but the land hides it — a real “one degree” place. Any base, any time: scan with H.",
    steps: [{ text: "Quick-scan (H) until a scan shows the Sun hidden by terrain", done: (e) => e.type === "scan" && e.sunHidden }],
  },
];

export const sideById = (id: string): SideQuest | undefined => SIDEQUESTS.find((q) => q.id === id);
