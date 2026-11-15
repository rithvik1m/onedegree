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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(4 * scale, 1 * scale, 1);
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
  dish: { yaw: THREE.Object3D; pitch: THREE.Object3D };
  beacons: Map<string, THREE.Object3D>;
  labels: THREE.Sprite[];
  spawn: { x: number; z: number; yaw: number };
  lander: { x: number; z: number };
}

export function buildOutpost(groundY: (x: number, z: number) => number, survey: { x: number; z: number }, sunAz = 250, surveyDist = 433): OutpostRefs {
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
  interactables.push({ id: "hab", label: "Enter Habitat (crew rest)", x: -6 + 6 + 1.6, z: 11, r: 2.6 });

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
  colliders.push({ x: ssX, z: ssZ, r: 0.6 });
  interactables.push({ id: "solar", label: "Analyze sunlight · Solar Monitoring Station", x: ssX, z: ssZ - 1.2, r: 2.8 });
  addLabel("SOLAR STATION", "Mission 01 · First Light", ssX, ssY + 3, ssZ, 0.9);
  beacons.set("solar", station);

  // --- Vertical solar arrays: they rotate to face the Sun's azimuth ---
  const arrays: THREE.Object3D[] = [];
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
  interactables.push({ id: "lander", label: "Board spacecraft · launch to orbit", x: lpX - 4.6, z: lpZ - 1, r: 3 });
  addLabel("LANDER · OD-1", "your ride to orbit (fictional)", lpX, lpY + 12, lpZ);
  beacons.set("lander", lander);

  // --- Rover parking ---
  const rvX = 24, rvZ = 28;
  const rvY = groundY(rvX, rvZ);
  const rover = buildRover();
  rover.position.set(rvX, rvY, rvZ);
  rover.rotation.y = -0.5;
  group.add(rover);
  colliders.push({ x: rvX, z: rvZ, r: 2.4 });
  const canopy = mesh(new THREE.BoxGeometry(7, 0.12, 5), M.cells);
  canopy.position.set(rvX + 0.3, rvY + 3.6, rvZ + 0.2);
  group.add(canopy);
  for (const [cx, cz] of [[-3.3, -2.3], [3.3, -2.3], [-3.3, 2.3], [3.3, 2.3]]) {
    const post = mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 8), M.metal);
    post.position.set(rvX + 0.3 + (cx as number), rvY + 1.8, rvZ + 0.2 + (cz as number));
    group.add(post);
  }
  addLabel("ROVER BAY", "pressurized rover (display only)", rvX, rvY + 5.2, rvZ, 0.9);

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
  path(4, 6, rvX - 2, rvZ - 2);

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
    group, colliders, interactables, arrays, dish: { yaw, pitch }, beacons, labels,
    // spawn with the Sun behind you, looking at the lit side of the base
    spawn: (() => {
      const a = sunAz * D2R;
      const cx = -6, cz = 2, r = 34;
      const x = cx + Math.sin(a) * r, z = cz - Math.cos(a) * r;
      return { x, z, yaw: Math.atan2(cx - x, -(cz - z)) };
    })(),
    lander: { x: lpX, z: lpZ },
  };
}

export function buildLander(): THREE.Group {
  const g = new THREE.Group();
  const desc = mesh(new THREE.CylinderGeometry(2.4, 2.6, 2.2, 8), M.gold);
  desc.position.y = 2.6;
  g.add(desc);
  const deck = mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.2, 8), M.metal);
  deck.position.y = 3.75;
  g.add(deck);
  const cabin = mesh(new THREE.CylinderGeometry(1.6, 1.9, 3.2, 20), M.white);
  cabin.position.y = 5.45;
  g.add(cabin);
  const nose = mesh(new THREE.SphereGeometry(1.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
  nose.position.y = 7.05;
  nose.scale.y = 0.6;
  g.add(nose);
  const hatch = mesh(new THREE.BoxGeometry(0.1, 1.4, 0.9), M.dark);
  hatch.position.set(-1.83, 5.2, 0);
  g.add(hatch);
  const win = mesh(new THREE.BoxGeometry(0.06, 0.35, 0.6), M.window, false);
  win.position.set(-1.7, 6.3, 0);
  g.add(win);
  const ladder = mesh(new THREE.BoxGeometry(0.06, 3.8, 0.5), M.metal);
  ladder.position.set(-2.75, 1.9, 0);
  ladder.rotation.z = -0.12;
  g.add(ladder);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), M.metal);
    leg.position.set(Math.cos(a) * 3.1, 1.4, Math.sin(a) * 3.1);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    g.add(leg);
    const foot = mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.12, 12), M.metal);
    foot.position.set(Math.cos(a) * 3.85, 0.06, Math.sin(a) * 3.85);
    g.add(foot);
  }
  const bell = mesh(new THREE.CylinderGeometry(0.5, 0.9, 1.0, 16, 1, true), M.dark);
  bell.position.y = 1.1;
  g.add(bell);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const rcs = mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), M.metal);
    rcs.position.set(Math.cos(a) * 1.75, 6.4, Math.sin(a) * 1.75);
    g.add(rcs);
  }
  return g;
}

function buildRover(): THREE.Group {
  const g = new THREE.Group();
  const cab = mesh(new THREE.BoxGeometry(2.6, 1.7, 4.2), M.white);
  cab.position.y = 1.55;
  g.add(cab);
  const front = mesh(new THREE.BoxGeometry(2.4, 0.9, 0.2), M.window, false);
  front.position.set(0, 1.9, -2.12);
  g.add(front);
  const roof = mesh(new THREE.BoxGeometry(2.2, 0.08, 3.4), M.cells);
  roof.position.set(0, 2.45, 0.2);
  g.add(roof);
  for (const z of [-1.4, 0, 1.4]) {
    for (const s of [-1, 1]) {
      const w = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 18), M.dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 1.45, 0.55, z);
      g.add(w);
    }
  }
  const mast = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), M.metal);
  mast.position.set(0.8, 3.0, 1.4);
  g.add(mast);
  return g;
}
