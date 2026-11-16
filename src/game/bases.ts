// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Data-driven research bases. Each base is a fictional facility on a REAL site that a
 * script chose from NASA maps (scripts/outpost.py, scripts/bases.py). A base definition
 * lists its models, interactables and spawn points in the site's local frame (metres,
 * x east, z south). The terrain under it is always the measured LOLA patch; buildings
 * never touch the science.
 */

export interface BasePiece {
  model: string; // kit model name (public/models/kit) or "proc:<name>"
  size: number; // metres (largest horizontal extent, or height if by = "height")
  by?: "width" | "height";
  x: number;
  z: number;
  rot?: number;
  label?: [string, string];
  collide?: number; // collider radius
  track?: "sun" | "earth"; // turns to face the Sun or Earth azimuth
}

export interface BaseInteract {
  /** "inst:<kind>:<placeId>[:<refId>]" opens an instrument; other ids are handled by main */
  id: string;
  label: string;
  x: number;
  z: number;
  r: number;
}

export interface BaseDef {
  id: string; // = site id in sites.json and patch id in public/data/surface
  name: string;
  short: string;
  theme: string;
  pieces: BasePiece[];
  interacts: BaseInteract[];
  spawn: { x: number; z: number; yaw: number };
  pad: { x: number; z: number };
  rover?: { x: number; z: number };
  /** partner survey point (site id) shown with a beacon */
  partner?: { id: string; label: string; sub: string };
  signs?: [string, string, number, number][];
}

export const BASES: BaseDef[] = [
  {
    id: "shadow",
    name: "Shadow Research Station",
    short: "Shadow Station",
    theme: "How terrain steals sunlight: a station next to near-permanent shadow.",
    pieces: [
      { model: "geodesic_dome", size: 11, x: -10, z: 4, label: ["SHADOW STATION", "terrain & illumination lab"], collide: 6 },
      { model: "house_cylinder", size: 7, x: -2, z: 14, rot: 0.4, collide: 3.8 },
      { model: "house_single_support", size: 6, x: 8, z: -10, collide: 3.3, label: ["OBSERVATION PLATFORM", "look toward SH-2"] },
      { model: "solar_panel_structure", size: 8, x: 16, z: 8, rot: 0.2, collide: 4.4 },
      { model: "roof_antenna", size: 8, by: "height", x: -20, z: -8, collide: 1.2 },
      { model: "pickup_crate", size: 1.4, x: 3, z: 18, collide: 0.9 },
      { model: "pickup_crate", size: 1.2, x: 4.6, z: 19, rot: 0.8, collide: 0.8 },
      { model: "proc:sunsensor", size: 1, x: 6, z: -2, track: "sun", label: ["SHADOW SENSOR", "measure sunlight here"], collide: 0.7 },
    ],
    interacts: [
      { id: "inst:solar:shadow", label: "Measure sunlight · Shadow Sensor", x: 6, z: -3.4, r: 2.8 },
      { id: "inst:survey:sh2:shadow", label: "Measure sunlight at SH-2 · survey marker", x: 0, z: 0, r: 4 }, // placed at SH-2 at runtime
    ],
    spawn: { x: 22, z: -14, yaw: -2.2 },
    pad: { x: 40, z: 30 },
    rover: { x: 18, z: 24 },
    partner: { id: "sh2", label: "SH-2", sub: "shadow survey point" },
    signs: [["Mind the shadow.", "It's colder than it looks.", -2, -4]],
  },
  {
    id: "earthlink",
    name: "EarthLink Communications Station",
    short: "EarthLink",
    theme: "Where Earth stays in view: dishes that track the real Earth.",
    pieces: [
      { model: "building_l", size: 12, x: -8, z: 6, rot: 1.2, label: ["EARTHLINK", "communications station"], collide: 6 },
      { model: "roof_radar", size: 9, by: "height", x: 10, z: -6, track: "earth", label: ["DISH A", "tracking Earth"], collide: 2.2 },
      { model: "roof_radar", size: 7, by: "height", x: 20, z: 4, track: "earth", collide: 1.9 },
      { model: "roof_radar", size: 6, by: "height", x: 2, z: -18, track: "earth", collide: 1.7 },
      { model: "solar_panel_structure", size: 9, x: -22, z: -10, rot: 0.3, collide: 4.8 },
      { model: "house_long", size: 9, x: -20, z: 16, rot: -0.5, collide: 4.2 },
      { model: "proc:console", size: 1, x: 4, z: 4, label: ["LINK CONSOLE", "line of sight to Earth"], collide: 0.7 },
    ],
    interacts: [
      { id: "inst:comms:earthlink", label: "Check line of sight · Link Console", x: 4, z: 2.6, r: 2.8 },
      { id: "lostsignal", label: "Inspect PROBE-7 · lost signal", x: 0, z: 0, r: 5 }, // placed at LS-1 at runtime
    ],
    spawn: { x: 26, z: -22, yaw: -2.0 },
    pad: { x: 36, z: 34 },
    rover: { x: 14, z: 22 },
    partner: { id: "ls1", label: "LS-1", sub: "PROBE-7 last known position" },
    signs: [["Earth: always calling.", "Sometimes from behind a hill.", 0, 9]],
  },
];

export const baseById = (id: string): BaseDef | undefined => BASES.find((b) => b.id === id);
