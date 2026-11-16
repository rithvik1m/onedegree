// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * A FICTIONAL research outpost, built procedurally (original geometry, no external
 * assets). Its location is real and data-chosen (scripts/outpost.py); the base
 * itself is a game set, not a NASA installation.
 *
 * Design notes grounded in published concepts:
 *  - Solar arrays are tall and VERTICAL because at the pole the Sun skims the
 *    horizon (NASA's Vertical Solar Array Technology concept); they turn to face
 *    the Sun's real azimuth.
 *  - The comms dish points at Earth's real direction (Horizons).
 *  - The landing pad sits ~140 m from the habitat to keep spray from landings away.
 */

import * as THREE from "three";
import { gated } from "./materials";
import type { Collider } from "./player";
import { kit, placeable, tint } from "./assets";
import type { BaseDef } from "../game/bases";

export interface Interactable {
  id: string;
  label: string;
  x: number;
  z: number;
  r: number;
  y?: number;
}

const D2R = Math.PI / 180;

const M = {
  white: gated(new THREE.MeshStandardMaterial({ color: 0xe4e1da, roughness: 0.55, metalness: 0.05 })),
  panel: gated(new THREE.MeshStandardMaterial({ color: 0xcfcbc2, roughness: 0.6, metalness: 0.1 })),
  metal: gated(new THREE.MeshStandardMaterial({ color: 0x8b9097, roughness: 0.35, metalness: 0.8 })),
  dark: gated(new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.3 })),
  cells: gated(new THREE.MeshStandardMaterial({ color: 0x1b2440, roughness: 0.25, metalness: 0.6 })),
  gold: gated(new THREE.MeshStandardMaterial({ color: 0xc8962e, roughness: 0.3, metalness: 1 })),
  orange: gated(new THREE.MeshStandardMaterial({ color: 0xd8642e, roughness: 0.5 })),
  window: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffc77a, emissiveIntensity: 1.6 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x58c7ff, emissiveIntensity: 1.2 }),
  pad: gated(new THREE.MeshStandardMaterial({ color: 0x6f6c66, roughness: 0.95 })),
  lightAmber: new THREE.MeshBasicMaterial({ color: 0xffb347 }),
  lightTeal: new THREE.MeshBasicMaterial({ color: 0x6fe0cf }),
  berm: gated(new THREE.MeshStandardMaterial({ color: 0x8e8a83, roughness: 1 })),
};

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadows = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadows;
  o.receiveShadow = true;
  return o;
}

export function label(text: string, sub = "", scale = 1): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "rgba(10,11,13,0.72)";
  g.beginPath();
  g.roundRect(4, 14, 504, sub ? 100 : 74, 18);
  g.fill();
  g.strokeStyle = "rgba(242,181,68,0.7)";
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = "#f4efe6";
  g.font = "600 40px Inter, system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(text, 256, 64);
  if (sub) {
    g.fillStyle = "rgba(244,239,230,0.7)";
    g.font = "500 26px Inter, system-ui, sans-serif";
    g.fillText(sub, 256, 100);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // fixed on-screen size (~26 px tall at 900 px viewport) instead of growing with distance
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, sizeAttenuation: false }));
  const k = 0.034 * Math.min(1, Math.max(0.75, scale));
  s.scale.set(k * (sub ? 4 : 4.6), k * (sub ? 1 : 0.75), 1);
  s.renderOrder = 10;
  return s;
}

/** Horizontal cylinder module with domed ends, windows and legs. */
function module(len: number, r: number, groundY: (x: number, z: number) => number, cx: number, cz: number, rotY: number, windows = true): { g: THREE.Group; top: number } {
  const g = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(r, r, len, 40, 1, true), M.white);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
    cap.rotation.z = (-s * Math.PI) / 2;
    cap.scale.y = 0.45;
    cap.position.x = (s * len) / 2;
    g.add(cap);
  }
  // panel rings
  for (let i = -len / 2 + 1; i <= len / 2 - 1; i += 2) {
    const ring = mesh(new THREE.TorusGeometry(r + 0.02, 0.035, 6, 48), M.panel, false);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = i;
    g.add(ring);
  }
  // foil band along the top (thermal blanket)
  const foil = mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, len * 0.9, 40, 1, true, -0.5, 1.0), M.gold, false);
  foil.rotation.z = Math.PI / 2;
  g.add(foil);
  if (windows) {
    for (let i = -len / 2 + 1.5; i <= len / 2 - 1.5; i += 2.2) {
      for (const side of [-1, 1]) {
        const w = mesh(new THREE.BoxGeometry(0.7, 0.35, 0.05), M.window, false);
        w.position.set(i, 0.5, side * (r - 0.02));
        g.add(w);
      }
    }
  }
  // legs down to the terrain
  const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
  const pts: [number, number][] = [];
  for (const lx of [-len / 2 + 0.8, len / 2 - 0.8]) for (const lz of [-r * 0.7, r * 0.7]) pts.push([lx, lz]);
  let top = -Infinity;
  for (const [lx, lz] of pts) top = Math.max(top, groundY(cx + lx * cosR + lz * sinR, cz - lx * sinR + lz * cosR));
  const floor = top + 1.0 + r;
  for (const [lx, lz] of pts) {
    const gy = groundY(cx + lx * cosR + lz * sinR, cz - lx * sinR + lz * cosR);
    const h = floor - r * 0.6 - gy + 0.3;
    const leg = mesh(new THREE.CylinderGeometry(0.09, 0.12, h, 8), M.metal);
    leg.position.set(lx, -r * 0.6 - h / 2 + 0.3, lz);
    g.add(leg);
    const foot = mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 12), M.metal);
    foot.position.set(lx, -r * 0.6 - h + 0.3, lz);
    g.add(foot);
  }
  g.position.set(cx, floor, cz);
  g.rotation.y = rotY;
  return { g, top: floor + r };
}

export interface OutpostRefs {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  arrays: THREE.Object3D[];
  dish: { yaw: THREE.Object3D; pitch: THREE.Object3D; radar: THREE.Object3D | null };
  /** extra pieces that turn to the Sun or Earth azimuth (data-driven bases) */
  trackers?: { o: THREE.Object3D; kind: "sun" | "earth" }[];
  beacons: Map<string, THREE.Object3D>;
  labels: THREE.Sprite[];
  spawn: { x: number; z: number; yaw: number };
  lander: { x: number; z: number };
  roverBay: { x: number; z: number };
}

export function buildOutpost(groundY: (x: number, z: number) => number, survey: { x: number; z: number }, sunAz = 250, surveyDist = 433, earthAz: number | null = null, useKit = false): OutpostRefs {
  const group = new THREE.Group();
  group.name = "outpost";
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const labels: THREE.Sprite[] = [];
  const beacons = new Map<string, THREE.Object3D>();
  const addLabel = (t: string, sub: string, x: number, y: number, z: number, s = 1): void => {
    const l = label(t, sub, s);
    l.position.set(x, y, z);
    group.add(l);
    labels.push(l);
  };

  /** Put a kit model on the terrain: base at the highest ground under its footprint (legs reach down). */
  const site = (name: Parameters<typeof placeable>[0], size: number, x: number, z: number, rotY = 0, by: "width" | "height" = "width"): THREE.Group => {
    const g = placeable(name, size, by);
    const sz = g.userData.size as THREE.Vector3;
    const r = Math.max(sz.x, sz.z) / 2;
    let top = -Infinity;
    for (const [dx, dz] of [[0, 0], [r * 0.7, 0], [-r * 0.7, 0], [0, r * 0.7], [0, -r * 0.7]] as [number, number][]) top = Math.max(top, groundY(x + dx, z + dz));
    g.position.set(x, top - 0.15, z);
    g.rotation.y = rotY;
    group.add(g);
    return g;
  };
  if (useKit) {
    // --- Habitat dome, Mission Control (L-module), lab dome, storage — Quaternius CC0 kit ---
    const hab = site("base_large", 12, -9, 12);
    colliders.push({ x: -9, z: 12, r: 6.2 });
    addLabel("HAB-1 · Habitat", "crew quarters (simulated)", -9, hab.position.y + (hab.userData.size as THREE.Vector3).y + 1.2, 12);
    addLabel("Great views.", "No atmosphere.", -9 + 6.8, groundY(-2.2, 15.5) + 1.4, 15.5, 0.75);
    const ctl = site("building_l", 13, -7, -7, Math.PI / 2);
    const ctlTop = ctl.position.y + (ctl.userData.size as THREE.Vector3).y;
    colliders.push({ x: -10, z: -7, r: 4.6 }, { x: -4, z: -7, r: 4.6 }, { x: -7, z: -3, r: 3.6 });
    addLabel("MISSION CONTROL", "walk in: planning console", -7, ctlTop + 1.6, -7);
    const doorX = -0.4;
    const door = new THREE.Group();
    const frame = mesh(new THREE.BoxGeometry(0.3, 2.4, 1.8), M.metal);
    const doorPanel = mesh(new THREE.BoxGeometry(0.32, 2.1, 1.3), M.dark, false);
    door.add(frame, doorPanel);
    for (const sgn of [-1, 1]) {
      const strip = mesh(new THREE.BoxGeometry(0.34, 2.1, 0.07), M.lightAmber, false);
      strip.position.z = sgn * 0.72;
      door.add(strip);
    }
    door.position.set(doorX, groundY(doorX, -7) + 1.2, -7);
    group.add(door);
    interactables.push({ id: "control", label: "Enter Mission Control", x: doorX + 1.6, z: -7, r: 3 });
    const lab = site("geodesic_dome", 10, -25, 2);
    colliders.push({ x: -25, z: 2, r: 5.4 });
    addLabel("SCI-LAB", "regolith samples (simulated)", -25, lab.position.y + (lab.userData.size as THREE.Vector3).y + 1.2, 2);
    site("house_cylinder", 6, -21, 15, 0.6);
    colliders.push({ x: -21, z: 15, r: 3.4 });
    site("roof_antenna", 7, -19, -13, 0, "height");
    colliders.push({ x: -19, z: -13, r: 1.2 });
    for (const [cx, cz, ry] of [[19.5, 33.5, 0.2], [21.2, 34.2, 0.9], [18.2, 31.8, 1.4]] as [number, number, number][]) {
      site("pickup_crate", 1.3, cx, cz, ry);
      colliders.push({ x: cx, z: cz, r: 0.8 });
    }
    // boulders (decorative, CC0 kit rocks tinted to regolith; never used by any calculation)
    const rocks: [string, number, number, number][] = [[`rock_large`, 3.5, 46, -48], [`rock_large_2`, 4.2, -52, -30], [`rock`, 2.4, 60, 22], [`rock_2`, 2.8, -38, 40], [`rock_large`, 5, 70, -10], [`rock_large_2`, 3, -15, -45], [`rock`, 2, 30, 58], [`rock_2`, 3.2, 120, -60]];
    for (const [n, sz, x, z] of rocks) {
      const g = site(n as Parameters<typeof placeable>[0], sz, x, z, x * 0.37);
      g.position.y -= sz * 0.25;
      tint(g, 0x8e8a83, 1, true);
      colliders.push({ x, z, r: sz * 0.45 });
    }
  } else {
    // --- Habitat + Mission Control, joined by a tunnel ---
    const hab = module(12, 2.3, groundY, -6, 11, 0);
    group.add(hab.g);
    colliders.push({ x: -10, z: 11, r: 2.6 }, { x: -6, z: 11, r: 2.6 }, { x: -2, z: 11, r: 2.6 });
    addLabel("HAB-1 · Habitat", "crew quarters (simulated)", -6, hab.top + 1.3, 11);
    const ctl = module(9, 2.3, groundY, -6, -6, 0);
    group.add(ctl.g);
    colliders.push({ x: -8.5, z: -6, r: 2.6 }, { x: -4, z: -6, r: 2.6 });
    addLabel("MISSION CONTROL", "planning console inside", -6, ctl.top + 1.3, -6);
    const tunnelY = Math.min(hab.g.position.y, ctl.g.position.y) - 0.8;
    const tunnel = mesh(new THREE.CylinderGeometry(1.0, 1.0, 12.4, 24), M.panel);
    tunnel.rotation.x = Math.PI / 2;
    tunnel.position.set(-6, tunnelY, 2.5);
    group.add(tunnel);
    colliders.push({ x: -6, z: 2.5, r: 1.3 }, { x: -6, z: -0.5, r: 1.3 }, { x: -6, z: 5.5, r: 1.3 });
    // mission control door (east end) with a lit frame
    const doorX = -6 + 4.5 + 0.95;
    const door = new THREE.Group();
    const frame = mesh(new THREE.BoxGeometry(0.3, 2.2, 1.6), M.metal);
    door.add(frame);
    const doorPanel = mesh(new THREE.BoxGeometry(0.32, 1.9, 1.2), M.dark, false);
    door.add(doorPanel);
    for (const s of [-1, 1]) {
      const strip = mesh(new THREE.BoxGeometry(0.34, 1.9, 0.06), M.lightAmber, false);
      strip.position.z = s * 0.66;
      door.add(strip);
    }
    door.position.set(doorX, ctl.g.position.y - 0.7, -6);
    group.add(door);
    interactables.push({ id: "control", label: "Access Mission Control", x: doorX + 1.4, z: -6, r: 3 });

    // --- Science lab dome ---
    const labY = groundY(-24, 2);
    const lab = mesh(new THREE.SphereGeometry(5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
    lab.scale.y = 0.75;
    lab.position.set(-24, labY - 0.3, 2);
    group.add(lab);
    const labBerm = mesh(new THREE.CylinderGeometry(5.6, 6.4, 1.2, 40), M.berm);
    labBerm.position.set(-24, labY - 0.2, 2);
    group.add(labBerm);
    for (let a = 0; a < 6; a++) {
      const w = mesh(new THREE.BoxGeometry(0.9, 0.4, 0.1), M.window, false);
      const ang = (a / 6) * Math.PI * 2;
      w.position.set(-24 + Math.cos(ang) * 4.55, labY + 1.6, 2 + Math.sin(ang) * 4.55);
      w.lookAt(-24, labY + 1.6, 2);
      group.add(w);
    }
    colliders.push({ x: -24, z: 2, r: 6.2 });
    addLabel("SCI-LAB", "regolith samples (simulated)", -24, labY + 5.5, 2);
  }

  const arrays: THREE.Object3D[] = [];
  // --- Solar monitoring station (Mission 01) ---
  const ssX = 13, ssZ = -13;
  const ssY = groundY(ssX, ssZ);
  const station = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), M.metal);
    leg.position.set(Math.cos(a) * 0.35, 0.7, Math.sin(a) * 0.35);
    leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    station.add(leg);
  }
  const head = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 20), M.white);
  head.position.y = 1.45;
  station.add(head);
  const sensor = mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.cells);
  sensor.position.y = 1.54;
  station.add(sensor);
  const console1 = mesh(new THREE.BoxGeometry(0.7, 0.45, 0.06), M.dark);
  console1.position.set(0, 1.2, -0.5);
  console1.rotation.x = -0.4;
  station.add(console1);
  const scr = mesh(new THREE.PlaneGeometry(0.6, 0.36), new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xf2b544, emissiveIntensity: 1.1 }), false);
  scr.position.set(0, 1.205, -0.535);
  scr.rotation.x = -0.4 + Math.PI;
  scr.rotation.y = Math.PI;
  station.add(scr);
  station.position.set(ssX, ssY, ssZ);
  group.add(station);
  if (useKit) {
    // a reference solar panel stood upright (the Sun is near the horizon here), turned to the Sun by the world
    const panel = placeable("solar_panel_ground", 2.6);
    const pv = new THREE.Group();
    panel.rotation.x = -Math.PI / 2 + 0.05;
    panel.position.y = 1.5;
    pv.add(panel);
    pv.position.set(ssX + 2.4, groundY(ssX + 2.4, ssZ + 0.6), ssZ + 0.6);
    group.add(pv);
    arrays.push(pv);
    colliders.push({ x: ssX + 2.4, z: ssZ + 0.6, r: 1.2 });
  }
  colliders.push({ x: ssX, z: ssZ, r: 0.6 });
  interactables.push({ id: "solar", label: "Analyze sunlight · Solar Monitoring Station", x: ssX, z: ssZ - 1.2, r: 2.8 });
  addLabel("SOLAR STATION", "Mission 01 · First Light", ssX, ssY + 3, ssZ, 0.9);
  beacons.set("solar", station);

  // --- Vertical solar arrays: they rotate to face the Sun's azimuth ---
  for (const [ax, az] of [[26, -24], [38, -10], [30, -38]] as [number, number][]) {
    const gy = groundY(ax, az);
    const mast = mesh(new THREE.CylinderGeometry(0.18, 0.28, 13, 10), M.metal);
    mast.position.set(ax, gy + 6.5, az);
    group.add(mast);
    const pivot = new THREE.Group();
    pivot.position.set(ax, gy + 8.5, az);
    const wing = mesh(new THREE.BoxGeometry(3.2, 8, 0.08), M.cells);
    const frameA = mesh(new THREE.BoxGeometry(3.3, 8.1, 0.04), M.metal);
    frameA.position.z = 0.05;
    pivot.add(wing, frameA);
    for (let i = -3; i <= 3; i++) {
      const line = mesh(new THREE.BoxGeometry(3.2, 0.03, 0.09), M.metal, false);
      line.position.y = i * 1.1;
      pivot.add(line);
    }
    group.add(pivot);
    arrays.push(pivot);
    const base = mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.4, 16), M.panel);
    base.position.set(ax, gy + 0.1, az);
    group.add(base);
    colliders.push({ x: ax, z: az, r: 1.4 });
  }
  addLabel("VERTICAL SOLAR ARRAYS", "turn to face the real Sun azimuth", 32, groundY(32, -24) + 15, -24, 1.1);

  // --- Comms station: dish pointed at Earth (Mission 02) ---
  const csX = 11, csZ = 15;
  const csY = groundY(csX, csZ);
  let radarPivot: THREE.Object3D | null = null;
  const pedestal = mesh(new THREE.CylinderGeometry(0.35, 0.6, 2.2, 14), M.white);
  pedestal.position.set(csX, csY + 1.1, csZ);
  group.add(pedestal);
  const yaw = new THREE.Group();
  yaw.position.set(csX, csY + 2.4, csZ);
  const yoke = mesh(new THREE.BoxGeometry(0.3, 0.6, 1.4), M.metal);
  yaw.add(yoke);
  const pitch = new THREE.Group();
  pitch.position.y = 0.3;
  yaw.add(pitch);
  // dish faces local −z of `pitch` (so pitch.rotation.x = elevation)
  const dishG = new THREE.LatheGeometry(
    Array.from({ length: 14 }, (_, i) => new THREE.Vector2((i / 13) * 1.8, ((i / 13) * 1.8) ** 2 / 4.5)),
    40,
  );
  const dish = mesh(dishG, M.white);
  dish.rotation.x = -Math.PI / 2;
  dish.position.z = -0.4;
  pitch.add(dish);
  const feed = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), M.metal);
  feed.rotation.x = Math.PI / 2;
  feed.position.z = -1.1;
  pitch.add(feed);
  const feedHead = mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.2, 10), M.gold);
  feedHead.rotation.x = Math.PI / 2;
  feedHead.position.z = -1.8;
  pitch.add(feedHead);
  group.add(yaw);
  if (useKit) {
    // the kit radar dish stands in for the procedural one and turns to Earth's azimuth
    yaw.visible = false;
    pedestal.visible = false;
    const radar = placeable("roof_radar", 5.2, "height");
    radar.position.set(0, 0, 0);
    const pivot = new THREE.Group();
    pivot.position.set(csX, csY - 0.1, csZ);
    pivot.add(radar);
    group.add(pivot);
    radarPivot = pivot;
  }
  const term = mesh(new THREE.BoxGeometry(0.8, 1.2, 0.5), M.panel);
  term.position.set(csX - 2.4, csY + 0.6, csZ - 1.6);
  group.add(term);
  const termScr = mesh(new THREE.PlaneGeometry(0.62, 0.4), M.screen, false);
  termScr.position.set(csX - 2.4, csY + 1.0, csZ - 1.86);
  termScr.rotation.y = Math.PI;
  group.add(termScr);
  colliders.push({ x: csX, z: csZ, r: 0.9 }, { x: csX - 2.4, z: csZ - 1.6, r: 0.6 });
  interactables.push({ id: "comms", label: "Check line of sight to Earth · Comms Station", x: csX - 2.4, z: csZ - 2.9, r: 2.8 });
  addLabel("COMMS STATION", "Mission 02 · Calling Earth", csX, csY + 6, csZ, 0.9);
  beacons.set("comms", term);

  // --- Observation deck toward the crater interior ---
  const odX = -42, odZ = 8;
  const odY = groundY(odX, odZ);
  const deck = mesh(new THREE.BoxGeometry(8, 0.25, 5), M.metal);
  deck.position.set(odX, odY + 0.6, odZ);
  group.add(deck);
  for (const [lx, lz] of [[-3.8, -2.3], [3.8, -2.3], [-3.8, 2.3], [3.8, 2.3]]) {
    const gy = groundY(odX + (lx as number), odZ + (lz as number));
    const h = odY + 0.6 - gy;
    const leg = mesh(new THREE.CylinderGeometry(0.1, 0.1, Math.max(0.2, h), 8), M.metal);
    leg.position.set(odX + (lx as number), gy + h / 2, odZ + (lz as number));
    group.add(leg);
  }
  for (const [x0, z0, x1, z1] of [[-4, -2.5, -4, 2.5], [-4, -2.5, 4, -2.5], [-4, 2.5, 4, 2.5]] as number[][]) {
    const len = Math.hypot((x1 as number) - (x0 as number), (z1 as number) - (z0 as number));
    const rail = mesh(new THREE.BoxGeometry(len, 0.05, 0.05), M.orange, false);
    rail.position.set(odX + ((x0 as number) + (x1 as number)) / 2, odY + 1.7, odZ + ((z0 as number) + (z1 as number)) / 2);
    rail.rotation.y = -Math.atan2((z1 as number) - (z0 as number), (x1 as number) - (x0 as number));
    group.add(rail);
  }
  const scope = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.9, 12), M.white);
  scope.position.set(odX - 3, odY + 1.6, odZ);
  scope.rotation.z = 1.2;
  group.add(scope);
  interactables.push({ id: "deck", label: "Look into Shackleton crater · Observation Deck", x: odX + 3, z: odZ, r: 3.5 });
  addLabel("OBSERVATION DECK", "view west, over the crater", odX, odY + 4, odZ, 0.9);

  // --- Landing pad + lander (fictional design) ---
  const lpX = 99, lpZ = 99;
  const lpY = groundY(lpX, lpZ);
  const pad = mesh(new THREE.CylinderGeometry(15, 15.5, 0.6, 64), M.pad);
  pad.position.set(lpX, lpY - 0.15, lpZ);
  group.add(pad);
  const ringP = mesh(new THREE.TorusGeometry(12, 0.15, 6, 64), M.lightAmber, false);
  ringP.rotation.x = Math.PI / 2;
  ringP.position.set(lpX, lpY + 0.17, lpZ);
  group.add(ringP);
  const lander = buildLander();
  lander.position.set(lpX, lpY + 0.15, lpZ);
  group.add(lander);
  colliders.push({ x: lpX, z: lpZ, r: 3.6 });
  interactables.push({ id: "lander", label: "Board spacecraft · OD-1", x: lpX - 4.6, z: lpZ - 1, r: 3 });
  addLabel("LANDER · OD-1", "your ride to orbit (fictional)", lpX, lpY + 12, lpZ);
  beacons.set("lander", lander);

  // --- Rover parking (the driveable rover is placed here by the world) ---
  const rvX = 24, rvZ = 28;
  const rvY = groundY(rvX, rvZ);
  const bay = mesh(new THREE.RingGeometry(3.6, 3.9, 40), M.lightAmber, false);
  bay.rotation.x = -Math.PI / 2;
  bay.position.set(rvX, rvY + 0.06, rvZ);
  group.add(bay);

  // --- Small instruments ---
  const inst = (x: number, z: number, name: string, sub: string): void => {
    const gy = groundY(x, z);
    const box1 = mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), M.gold);
    box1.position.set(x, gy + 0.15, z);
    group.add(box1);
    const ant = mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 4), M.metal);
    ant.position.set(x + 0.15, gy + 0.8, z);
    group.add(ant);
    const tip = mesh(new THREE.SphereGeometry(0.035, 8, 6), M.lightTeal, false);
    tip.position.set(x + 0.15, gy + 1.3, z);
    group.add(tip);
    addLabel(name, sub, x, gy + 2.1, z, 0.6);
  };
  inst(4, -26, "SEISMOMETER", "simulated");
  inst(-16, -20, "RETROREFLECTOR", "simulated");

  // --- Paths: marker posts with lights from the hub to each site ---
  const path = (x0: number, z0: number, x1: number, z1: number, every = 6): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let s = every; s < len - 2; s += every) {
      const x = x0 + ((x1 - x0) * s) / len, z = z0 + ((z1 - z0) * s) / len;
      const gy = groundY(x, z);
      const post = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), M.metal, false);
      post.position.set(x, gy + 0.35, z);
      group.add(post);
      const lamp = mesh(new THREE.SphereGeometry(0.05, 6, 4), M.lightAmber, false);
      lamp.position.set(x, gy + 0.72, z);
      group.add(lamp);
    }
  };
  path(2, 0, ssX - 1, ssZ + 1);
  path(2, 2, csX - 2, csZ - 3);
  path(-12, 2, -19, 2);
  path(-29, 4, odX + 4, odZ);
  path(4, 4, lpX - 14, lpZ - 14, 8);
  path(4, 6, rvX - 4, rvZ - 4);

  // --- Survey marker S-1 (Mission 03): tall beacon so it can be found ---
  const sY = groundY(survey.x, survey.z);
  const sv = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), M.orange);
  pole.position.y = 1.25;
  sv.add(pole);
  const flag = mesh(new THREE.BoxGeometry(0.6, 0.35, 0.02), M.orange);
  flag.position.set(0.3, 2.3, 0);
  sv.add(flag);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 160, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 80;
  beam.name = "beam";
  sv.add(beam);
  sv.position.set(survey.x, sY, survey.z);
  group.add(sv);
  interactables.push({ id: "survey", label: "Deploy horizon scanner · Survey point S-1", x: survey.x, z: survey.z, r: 4 });
  beacons.set("survey", sv);
  const sl = label("SURVEY S-1", `Mission 03 · ${Math.round(surveyDist)} m from base`, 1.1);
  sl.position.set(survey.x, sY + 5, survey.z);
  group.add(sl);
  labels.push(sl);

  return {
    group, colliders, interactables, arrays, dish: { yaw, pitch, radar: radarPivot }, beacons, labels,
    // spawn with the Sun behind you, looking at the lit side of the base
    // and, when Earth is up, turned so Earth sits inside the frame
    spawn: (() => {
      let view = sunAz + 180;
      if (earthAz !== null) {
        const d = ((earthAz - view + 540) % 360) - 180;
        if (Math.abs(d) < 110 && Math.abs(d) > 30) view += d - Math.sign(d) * 32;
      }
      const a = view * D2R;
      const cx = 8, cz = -14, r = 22;
      return { x: cx - Math.sin(a) * r, z: cz + Math.cos(a) * r, yaw: a };
    })(),
    lander: { x: lpX, z: lpZ },
    roverBay: { x: rvX, z: rvZ },
  };
}

/**
 * OD-1 "Meridian" — the player's lander (original design, built in code). Body frame:
 * +Y = engine thrust axis, −Z = forward (cockpit windows), −X = hatch and ladder.
 * Named children the flight controller animates: "plume", "rcs0..3", "nav", "flood".
 */
export function buildLander(): THREE.Group {
  const g = new THREE.Group();
  g.name = "od1";
  const foil = gated(new THREE.MeshStandardMaterial({ color: 0xc8962e, roughness: 0.28, metalness: 1 }));
  const foilDark = gated(new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.45, metalness: 0.8 }));
  const hull = gated(new THREE.MeshStandardMaterial({ color: 0xe8e5de, roughness: 0.45, metalness: 0.15 }));
  // descent stage: octagonal foil-wrapped box with dark side bays
  const desc = mesh(new THREE.CylinderGeometry(2.5, 2.6, 2.0, 8), foil);
  desc.position.y = 2.55;
  desc.rotation.y = Math.PI / 8;
  g.add(desc);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const bay = mesh(new THREE.BoxGeometry(1.5, 1.3, 0.12), foilDark);
    bay.position.set(Math.sin(a) * 2.42, 2.55, Math.cos(a) * 2.42);
    bay.rotation.y = a;
    g.add(bay);
  }
  const deck = mesh(new THREE.CylinderGeometry(2.75, 2.75, 0.22, 8), M.metal);
  deck.position.y = 3.62;
  deck.rotation.y = Math.PI / 8;
  g.add(deck);
  // crew cabin: faceted ascent module with a forward window band
  const cabin = mesh(new THREE.CylinderGeometry(1.75, 2.0, 2.6, 10), hull);
  cabin.position.y = 5.05;
  g.add(cabin);
  const stripe = mesh(new THREE.CylinderGeometry(2.01, 2.01, 0.26, 10, 1, true), M.orange);
  stripe.position.y = 4.1;
  g.add(stripe);
  const roof = mesh(new THREE.CylinderGeometry(1.1, 1.75, 0.8, 10), hull);
  roof.position.y = 6.75;
  g.add(roof);
  const hatchTop = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 16), M.metal);
  hatchTop.position.y = 7.2;
  g.add(hatchTop);
  // cockpit windows (forward = −Z), angled like a real lander's
  for (const [x, w] of [[-0.62, 0.7], [0.62, 0.7], [0, 0.42]] as [number, number][]) {
    const win = mesh(new THREE.PlaneGeometry(w, 0.62), M.window, false);
    win.position.set(x, 5.7, -1.86 - (x === 0 ? 0.02 : 0));
    win.rotation.set(-0.2, Math.PI + (x === 0 ? 0 : -x * 0.5), 0);
    g.add(win);
  }
  const frame = mesh(new THREE.BoxGeometry(2.1, 0.08, 0.1), M.dark);
  frame.position.set(0, 6.05, -1.84);
  g.add(frame);
  // hatch + porch + ladder on −X
  const hatch = mesh(new THREE.BoxGeometry(0.1, 1.3, 0.95), M.dark);
  hatch.position.set(-1.92, 4.75, 0);
  g.add(hatch);
  const porch = mesh(new THREE.BoxGeometry(1.0, 0.08, 1.1), M.metal);
  porch.position.set(-3.0, 3.6, 0);
  g.add(porch);
  for (const dz of [-0.3, 0.3]) {
    const rail = mesh(new THREE.BoxGeometry(0.06, 3.7, 0.06), M.metal);
    rail.position.set(-3.5, 1.85, dz);
    rail.rotation.z = -0.14;
    g.add(rail);
  }
  for (let k = 0; k < 8; k++) {
    const rung = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.6), M.metal);
    rung.position.set(-3.27 - k * 0.055 * 0.0 - (0.4 - k * 0.05), 0.45 + k * 0.4, 0);
    g.add(rung);
  }
  // four legs: primary strut, secondary struts, footpad
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a), cz = Math.sin(a);
    const leg = mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.6, 8), M.metal);
    leg.position.set(cx * 3.15, 1.5, cz * 3.15);
    leg.rotation.set(cz * 0.5, 0, -cx * 0.5);
    g.add(leg);
    for (const s of [-1, 1]) {
      const st = mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), M.metal);
      const ox = -cz * s * 0.9, oz = cx * s * 0.9;
      st.position.set(cx * 2.85 + ox * 0.5, 1.15, cz * 2.85 + oz * 0.5);
      st.lookAt(cx * 3.9, -0.2, cz * 3.9);
      st.rotateX(Math.PI / 2);
      g.add(st);
    }
    const foot = mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.14, 14), M.metal);
    foot.position.set(cx * 3.95, 0.07, cz * 3.95);
    g.add(foot);
  }
  // main engine bell + plume
  const bell = mesh(new THREE.CylinderGeometry(0.45, 0.95, 1.1, 20, 1, true), M.dark);
  bell.position.y = 1.05;
  g.add(bell);
  const plumeMat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.85, 6, 20, 1, true), plumeMat);
  plume.name = "plume";
  plume.rotation.x = Math.PI;
  plume.position.y = 0.5 - 3;
  plume.visible = false;
  g.add(plume);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.4, 3, 14, 1, true), plumeMat.clone());
  core.name = "plumeCore";
  core.rotation.x = Math.PI;
  core.position.y = 0.5 - 1.5;
  core.visible = false;
  g.add(core);
  // four RCS quads at the cabin corners
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const q = new THREE.Group();
    q.name = `rcs${i}`;
    const box = mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), M.metal);
    q.add(box);
    for (const [dx, dy, dz] of [[0.24, 0, 0], [0, 0.24, 0], [0, -0.24, 0], [0, 0, 0.24]] as [number, number, number][]) {
      const n = mesh(new THREE.ConeGeometry(0.07, 0.16, 8, 1, true), M.dark);
      n.position.set(dx, dy, dz);
      if (dx) n.rotation.z = -Math.PI / 2;
      if (dy < 0) n.rotation.z = Math.PI;
      if (dz) n.rotation.x = Math.PI / 2;
      q.add(n);
    }
    q.position.set(Math.cos(a) * 2.05, 5.9, Math.sin(a) * 2.05);
    q.rotation.y = -a;
    g.add(q);
  }
  // high-gain dish + antenna mast
  const mast = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), M.metal);
  mast.position.set(1.0, 7.5, 0.6);
  g.add(mast);
  const dish = mesh(new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), M.white);
  dish.position.set(1.0, 8.1, 0.6);
  dish.rotation.x = -Math.PI / 2.4;
  g.add(dish);
  // nav lights (port red, starboard green, white strobe on top) and a landing floodlight
  const nav = new THREE.Group();
  nav.name = "nav";
  for (const [x, y, z, c] of [[-2.1, 5.2, -0.9, 0xff3b30], [2.1, 5.2, -0.9, 0x34c759], [0, 7.32, 0, 0xffffff]] as [number, number, number, number][]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
    l.position.set(x, y, z);
    nav.add(l);
  }
  g.add(nav);
  const flood = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.18), new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));
  flood.name = "flood";
  flood.position.set(0, 3.3, -2.6);
  g.add(flood);
  return g;
}

/**
 * Apollo Lunar Module DESCENT STAGE — an approximate, simplified reconstruction (original
 * geometry, not a NASA model): octagonal stage wrapped in gold/black foil, four legs with
 * footpads, a ladder on the forward leg. The ascent stage left for orbit, so it is absent.
 */
export function buildApolloDescentStage(): THREE.Group {
  const g = new THREE.Group();
  const gold = gated(new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.35, metalness: 0.9 }));
  const black = gated(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }));
  const silver = gated(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.85 }));
  const body = mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.65, 8), gold);
  body.position.y = 2.2;
  body.rotation.y = Math.PI / 8;
  g.add(body);
  const top = mesh(new THREE.CylinderGeometry(2.12, 2.12, 0.12, 8), black);
  top.position.y = 3.05;
  top.rotation.y = Math.PI / 8;
  g.add(top);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const leg = mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.1, 8), silver);
    leg.position.set(ca * 3.0, 1.35, sa * 3.0);
    leg.rotation.set(sa * 0.55, 0, -ca * 0.55);
    g.add(leg);
    const strut = mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), silver);
    strut.position.set(ca * 2.4, 0.9, sa * 2.4);
    strut.rotation.set(sa * 1.0, 0, -ca * 1.0);
    g.add(strut);
    const pad = mesh(new THREE.CylinderGeometry(0.45, 0.47, 0.12, 16), silver);
    pad.position.set(ca * 3.85, 0.06, sa * 3.85);
    g.add(pad);
  }
  const ladder = new THREE.Group();
  for (const sx of [-0.25, 0.25]) {
    const rail = mesh(new THREE.BoxGeometry(0.05, 2.6, 0.05), silver);
    rail.position.set(sx, 0, 0);
    ladder.add(rail);
  }
  for (let k = 0; k < 8; k++) {
    const rung = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.05), silver);
    rung.position.y = -1.1 + k * 0.32;
    ladder.add(rung);
  }
  ladder.position.set(0, 1.5, -3.0);
  ladder.rotation.x = -0.45;
  g.add(ladder);
  const porch = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.6), silver);
  porch.position.set(0, 2.85, -2.3);
  g.add(porch);
  return g;
}

/** Dashed ring marking a heritage keep-out distance. */
export function heritageRing(radius: number, groundY: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  const n = 96;
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = Math.sin(a0) * radius, z0 = -Math.cos(a0) * radius, x1 = Math.sin(a1) * radius, z1 = -Math.cos(a1) * radius;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.25), M.lightAmber);
    seg.position.set((x0 + x1) / 2, groundY((x0 + x1) / 2, (z0 + z1) / 2) + 0.05, (z0 + z1) / 2);
    seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    g.add(seg);
  }
  return g;
}

/** Build a data-driven research base (src/game/bases.ts) on its measured terrain. */
export function buildBase(def: BaseDef, groundY: (x: number, z: number) => number, partner: { x: number; z: number } | null): OutpostRefs {
  const group = new THREE.Group();
  group.name = `base-${def.id}`;
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const labels: THREE.Sprite[] = [];
  const beacons = new Map<string, THREE.Object3D>();
  const trackers: { o: THREE.Object3D; kind: "sun" | "earth" }[] = [];
  const addLabel = (t: string, sub: string, x: number, y: number, z: number, k = 1): void => {
    const l = label(t, sub, k);
    l.position.set(x, y, z);
    group.add(l);
    labels.push(l);
  };
  for (const p of def.pieces) {
    let obj: THREE.Object3D;
    let height = 3;
    if (p.model === "proc:sunsensor") {
      const g = new THREE.Group();
      const mast = mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 8), M.metal);
      mast.position.y = 0.8;
      const head = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), M.cells);
      head.position.y = 1.7;
      const scr = mesh(new THREE.BoxGeometry(0.6, 0.38, 0.08), M.screen, false);
      scr.position.set(0, 1.05, -0.12);
      g.add(mast, head, scr);
      obj = g;
      height = 2;
    } else if (p.model === "proc:console") {
      const g = new THREE.Group();
      const body = mesh(new THREE.BoxGeometry(1.0, 1.2, 0.6), M.panel);
      body.position.y = 0.6;
      const scr = mesh(new THREE.PlaneGeometry(0.8, 0.45), M.screen, false);
      scr.position.set(0, 1.0, -0.31);
      scr.rotation.y = Math.PI;
      g.add(body, scr);
      obj = g;
      height = 1.4;
    } else {
      obj = placeable(p.model as Parameters<typeof placeable>[0], p.size, p.by ?? "width");
      height = (obj.userData.size as THREE.Vector3).y;
    }
    // sit on the highest ground under the footprint (legs reach down)
    const r = p.size / 2;
    let top = -Infinity;
    for (const [dx, dz] of [[0, 0], [r * 0.6, 0], [-r * 0.6, 0], [0, r * 0.6], [0, -r * 0.6]] as [number, number][]) top = Math.max(top, groundY(p.x + dx, p.z + dz));
    const holder = new THREE.Group();
    holder.position.set(p.x, top - 0.1, p.z);
    holder.add(obj);
    obj.rotation.y = p.rot ?? 0;
    group.add(holder);
    if (p.track) trackers.push({ o: obj, kind: p.track });
    if (p.collide) colliders.push({ x: p.x, z: p.z, r: p.collide });
    if (p.label) addLabel(p.label[0], p.label[1], p.x, top + height + 1.4, p.z, 0.95);
  }
  for (const it of def.interacts) {
    const at = it.x === 0 && it.z === 0 && partner ? partner : { x: it.x, z: it.z };
    interactables.push({ id: it.id, label: it.label, x: at.x, z: at.z, r: it.r });
  }
  // landing pad + lander
  const pY = groundY(def.pad.x, def.pad.z);
  const pad = mesh(new THREE.CylinderGeometry(14, 14.5, 0.6, 64), M.pad);
  pad.position.set(def.pad.x, pY - 0.15, def.pad.z);
  group.add(pad);
  const ringP = mesh(new THREE.TorusGeometry(11, 0.15, 6, 64), M.lightAmber, false);
  ringP.rotation.x = Math.PI / 2;
  ringP.position.set(def.pad.x, pY + 0.17, def.pad.z);
  group.add(ringP);
  const lander = buildLander();
  lander.position.set(def.pad.x, pY + 0.15, def.pad.z);
  group.add(lander);
  colliders.push({ x: def.pad.x, z: def.pad.z, r: 3.6 });
  interactables.push({ id: "lander", label: "Board spacecraft · OD-1", x: def.pad.x - 4.6, z: def.pad.z - 1, r: 3 });
  addLabel("LANDER · OD-1", "your spacecraft", def.pad.x, pY + 12, def.pad.z);
  beacons.set("lander", lander);
  if (def.rover) {
    const bay = mesh(new THREE.RingGeometry(3.6, 3.9, 40), M.lightAmber, false);
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(def.rover.x, groundY(def.rover.x, def.rover.z) + 0.06, def.rover.z);
    group.add(bay);
  }
  for (const [t, sub, x, z] of def.signs ?? []) addLabel(t, sub, x, groundY(x, z) + 1.4, z, 0.75);
  // partner survey point: beacon (and, at EarthLink, the fictional lost probe)
  if (partner && def.partner) {
    const sY = groundY(partner.x, partner.z);
    const sv = new THREE.Group();
    const pole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), M.orange);
    pole.position.y = 1.25;
    sv.add(pole);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 160, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 80;
    beam.name = "beam";
    sv.add(beam);
    sv.position.set(partner.x, sY, partner.z);
    group.add(sv);
    beacons.set("survey", sv);
    if (def.id === "earthlink") {
      try {
        const probe = kit("rover").scene.clone(true);
        probe.scale.setScalar(0.55);
        probe.rotation.set(0.12, 0.7, -0.08);
        probe.position.set(partner.x + 3, groundY(partner.x + 3, partner.z + 2) + 0.2, partner.z + 2);
        tint(probe, 0x9a9690, 0.4);
        group.add(probe);
      } catch {
        /* kit not loaded: beacon only */
      }
    }
    const sl = label(def.partner.label, def.partner.sub, 1);
    sl.position.set(partner.x, sY + 5, partner.z);
    group.add(sl);
    labels.push(sl);
  }
  const dummy = new THREE.Group();
  return {
    group, colliders, interactables, arrays: trackers.filter((t) => t.kind === "sun").map((t) => t.o),
    dish: { yaw: dummy, pitch: dummy, radar: null }, beacons, labels,
    spawn: def.spawn, lander: def.pad, roverBay: def.rover ?? { x: def.pad.x - 20, z: def.pad.z }, trackers,
  };
}

/**
 * Collision from the real geometry: oriented boxes fitted (minimum-area, 3° steps) to the
 * footprint of every solid part of a facility. Flat things you can walk over (pads, rings,
 * paths) and see-through beams are skipped. Composite objects larger than 40 m² are split into
 * their parts so gaps between parts stay walkable.
 */
export function buildColliders(group: THREE.Object3D, ground: (x: number, z: number) => number, skip: Set<THREE.Object3D>): Collider[] {
  group.updateMatrixWorld(true);
  const out: Collider[] = [];
  const v = new THREE.Vector3();
  const pointsOf = (o: THREE.Object3D): { xs: number[]; zs: number[]; minY: number; maxY: number } => {
    const xs: number[] = [], zs: number[] = [];
    let minY = Infinity, maxY = -Infinity;
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh || skip.has(mesh)) return;
      const mat = mesh.material as THREE.Material & { transparent?: boolean; opacity?: number };
      if (mat && !Array.isArray(mat) && mat.transparent && (mat.opacity ?? 1) < 0.6) return;
      const pos = mesh.geometry.getAttribute("position");
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 300));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        xs.push(v.x); zs.push(v.z);
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
    });
    return { xs, zs, minY, maxY };
  };
  const fit = (o: THREE.Object3D, depth: number): void => {
    if (skip.has(o) || (o as THREE.Sprite).isSprite) return;
    const P = pointsOf(o);
    if (P.xs.length < 3) return;
    let best = { area: Infinity, a: 0, u0: 0, u1: 0, v0: 0, v1: 0 };
    for (let k = 0; k < 60; k++) {
      const a = (k * Math.PI) / 60, ca = Math.cos(a), sa = Math.sin(a);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < P.xs.length; i++) {
        const x = P.xs[i] as number, z = P.zs[i] as number;
        const u = x * ca - z * sa, w = x * sa + z * ca;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < v0) v0 = w; if (w > v1) v1 = w;
      }
      const area = (u1 - u0) * (v1 - v0);
      if (area < best.area) best = { area, a, u0, u1, v0, v1 };
    }
    const kids = o.children.filter((c) => !(c as THREE.Sprite).isSprite);
    if (best.area > 40 && depth < 4 && kids.length > 1) { for (const c of kids) fit(c, depth + 1); return; }
    const ca = Math.cos(best.a), sa = Math.sin(best.a);
    const uc = (best.u0 + best.u1) / 2, vc = (best.v0 + best.v1) / 2;
    const x = uc * ca + vc * sa, z = -uc * sa + vc * ca;
    const g = ground(x, z);
    if (P.maxY - Math.max(P.minY, g) < 0.7) return; // flat: walk over it
    const hx = Math.max(0.12, (best.u1 - best.u0) / 2), hz = Math.max(0.12, (best.v1 - best.v0) / 2);
    if (hx * hz > 400) return; // never a giant invisible wall
    out.push({ x, z, r: Math.hypot(hx, hz), hx, hz, rot: best.a, top: P.maxY });
  };
  for (const c of group.children) fit(c, 0);
  return out;
}
