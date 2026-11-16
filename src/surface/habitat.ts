// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * HAB-1 crew quarters — an enterable interior (fictional facility). One compact module:
 * airlock door, two bunks, lockers, a galley table with the crew's notes, a suit-charging
 * station, a viewport and a life-support panel. Furniture is solid (same oriented-box
 * colliders as outdoors). Life-support numbers are labelled fictional; the viewport and the
 * Sun/Earth line on the panel come from the real mission clock.
 */
import * as THREE from "three";
import { resolveCircle, type Collider } from "./player";
import type { Interactable } from "./outpost";
import type { Screen } from "./interior";

export const HAB = { w: 8, d: 5.2, h: 2.7 };

function canvasTex(w: number, h: number): { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, g };
}

export class HabitatInterior {
  readonly kind = "habitat";
  readonly scene = new THREE.Scene();
  readonly interactables: Interactable[] = [];
  readonly screens: Screen[] = [];
  readonly entry = { x: 3.0, z: 0.6, yaw: -Math.PI / 2 };
  private colliders: Collider[] = [];
  private lamp: THREE.PointLight;
  private ecl: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D };
  /** filled in by the game each time you enter: Sun and Earth now, from Horizons × LOLA */
  status = { sun: "—", earth: "—", utc: "—" };

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x060607);
    const { w, d, h } = HAB;
    const fabric = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.95 });
    const panel = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7, metalness: 0.05 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd8642e, roughness: 0.55 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8b9097, roughness: 0.4, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.8 });
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, solid = false): THREE.Mesh => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      b.position.set(x, y, z);
      s.add(b);
      if (solid) this.colliders.push({ x, z, r: Math.hypot(sx, sz) / 2, hx: sx / 2, hz: sz / 2, rot: 0 });
      return b;
    };
    // shell: padded floor, insulated walls with an orange trim line, a curved-ceiling feel
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    for (const [ww, x, z, ry] of [[w, 0, -d / 2, 0], [w, 0, d / 2, Math.PI], [d, -w / 2, 0, Math.PI / 2], [d, w / 2, 0, -Math.PI / 2]] as [number, number, number, number][]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, h), panel);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      s.add(m);
      const t = new THREE.Mesh(new THREE.PlaneGeometry(ww, 0.08), trim);
      t.position.set(x, 1.05, z);
      t.rotation.y = ry;
      t.translateZ(0.005);
      s.add(t);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h;
    s.add(ceil);
    // lighting: warm ceiling strip + a soft fill (no shadow-casting lights)
    const strip = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    box(w * 0.7, 0.03, 0.16, 0, h - 0.02, 0, strip);
    s.add(new THREE.AmbientLight(0xc8ccd6, 0.6));
    this.lamp = new THREE.PointLight(0xffe7c4, 8, 12, 1.6);
    this.lamp.position.set(0, h - 0.35, 0);
    s.add(this.lamp);

    // airlock door (east wall) with a status light
    box(0.12, 2.1, 1.2, w / 2 - 0.06, 1.05, 0.6, dark);
    box(0.14, 0.12, 0.12, w / 2 - 0.08, 2.25, 0.6, new THREE.MeshBasicMaterial({ color: 0x6fe0a0 }));
    // bunks (north-west): two stacked beds with blankets and pillows
    for (const y of [0.45, 1.45]) {
      box(2.0, 0.12, 0.9, -2.7, y, -2.05, metal);
      box(1.9, 0.14, 0.82, -2.7, y + 0.13, -2.05, fabric);
      box(1.2, 0.05, 0.8, -2.35, y + 0.22, -2.05, new THREE.MeshStandardMaterial({ color: 0x3b5a7a, roughness: 0.95 }));
      box(0.4, 0.1, 0.6, -3.45, y + 0.25, -2.05, new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1 }));
    }
    box(2.0, 2.0, 0.9, -2.7, 1.0, -2.05, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 }), true).visible = false;
    // lockers (south wall)
    for (let i = 0; i < 4; i++) {
      box(0.6, 1.9, 0.5, -3.3 + i * 0.65, 0.95, d / 2 - 0.27, i % 2 ? panel : new THREE.MeshStandardMaterial({ color: 0xcfcbc2, roughness: 0.6 }));
      box(0.04, 0.25, 0.04, -3.1 + i * 0.65, 1.0, d / 2 - 0.53, metal);
    }
    this.colliders.push({ x: -2.33, z: d / 2 - 0.27, r: 1.4, hx: 1.3, hz: 0.27, rot: 0 });
    // galley table with notes and a mug
    box(1.3, 0.06, 0.8, 0.4, 0.78, -0.2, wood, true);
    box(0.08, 0.76, 0.08, 0.4, 0.38, -0.2, metal);
    box(0.32, 0.01, 0.24, 0.2, 0.815, -0.25, new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 1 }));
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 14), trim);
    mug.position.set(0.75, 0.86, -0.05);
    s.add(mug);
    // suit-charging station (north-east): a suit hanging on a rack + charge light
    box(0.9, 2.0, 0.35, 2.4, 1.0, -d / 2 + 0.2, metal, true);
    box(0.55, 0.8, 0.3, 2.4, 1.35, -d / 2 + 0.45, new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.8 }));
    box(0.1, 0.1, 0.02, 2.4, 1.85, -d / 2 + 0.6, new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    // viewport (west wall): a window onto the lunar night sky
    const view = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x0b0d12 }));
    view.position.set(-w / 2 + 0.01, 1.6, 0.6);
    view.rotation.y = Math.PI / 2;
    s.add(view);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 8, 32), metal);
    rim.position.copy(view.position);
    rim.rotation.y = Math.PI / 2;
    s.add(rim);
    for (let i = 0; i < 40; i++) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.008), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.38;
      st.position.set(-w / 2 + 0.015, 1.6 + Math.sin(a) * r, 0.6 + Math.cos(a) * r);
      st.rotation.y = Math.PI / 2;
      s.add(st);
    }
    // a small plant chamber (easter egg)
    box(0.5, 0.5, 0.4, 3.4, 1.3, -d / 2 + 0.25, new THREE.MeshStandardMaterial({ color: 0x223322, transparent: true, opacity: 0.55, roughness: 0.2 }));
    box(0.3, 0.18, 0.2, 3.4, 1.18, -d / 2 + 0.25, new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 0.9 }));
    box(0.5, 0.9, 0.4, 3.4, 0.45, -d / 2 + 0.25, panel, true);
    // life-support panel (north wall, centre): a live canvas screen
    this.ecl = canvasTex(512, 300);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.76), new THREE.MeshBasicMaterial({ map: this.ecl.tex }));
    scr.position.set(0.2, 1.6, -d / 2 + 0.02);
    s.add(scr);
    this.screens.push({ draw: () => this.drawEcl(), tex: this.ecl.tex, g: this.ecl.g, w: 512, h: 300 });

    this.interactables.push(
      { id: "hab-exit", label: "Airlock · exit to the surface", x: w / 2 - 0.9, z: 0.6, r: 1.0 },
      { id: "hab-bunk", label: "Bunk · rest 8 hours (advances the mission clock)", x: -2.7, z: -1.15, r: 1.0 },
      { id: "hab-notes", label: "Crew notes on the galley table", x: 0.4, z: 0.55, r: 0.9 },
      { id: "hab-ecl", label: "Life-support panel", x: 0.2, z: -d / 2 + 0.9, r: 0.9 },
      { id: "hab-suit", label: "Suit-charging station", x: 2.4, z: -d / 2 + 1.05, r: 0.9 },
      { id: "hab-view", label: "Viewport", x: -w / 2 + 0.8, z: 0.6, r: 0.9 },
      { id: "hab-locker", label: "Locker 3 · personal effects", x: -1.35, z: d / 2 - 1.0, r: 0.8 },
    );
    this.drawEcl();
  }

  drawEcl(): void {
    const { g } = this.ecl;
    g.fillStyle = "#06090d";
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = "#6fe0d0";
    g.font = "600 22px system-ui, sans-serif";
    g.fillText("HAB-1 · LIFE SUPPORT", 20, 36);
    g.fillStyle = "#8a8f98";
    g.font = "15px system-ui, sans-serif";
    g.fillText("fictional values — not an engineering model", 20, 60);
    g.font = "600 20px ui-monospace, monospace";
    const rows: [string, string, string][] = [["O₂", "21.0 %", "#9fe8b8"], ["CO₂", "0.31 %", "#9fe8b8"], ["Cabin", "21.5 °C", "#9fe8b8"], ["Pressure", "101 kPa", "#9fe8b8"]];
    rows.forEach(([k, v, c], i) => {
      g.fillStyle = "#c8ccd6";
      g.fillText(k, 20, 100 + i * 30);
      g.fillStyle = c;
      g.fillText(v, 200, 100 + i * 30);
    });
    g.fillStyle = "#ffb347";
    g.font = "600 16px system-ui, sans-serif";
    g.fillText(`Sun: ${this.status.sun}`, 20, 238);
    g.fillStyle = "#6fa8dc";
    g.fillText(`Earth: ${this.status.earth}`, 20, 262);
    g.fillStyle = "#8a8f98";
    g.font = "14px ui-monospace, monospace";
    g.fillText(`${this.status.utc} UTC · NASA/JPL Horizons × LOLA`, 20, 286);
    this.ecl.tex.needsUpdate = true;
  }

  clamp(p: THREE.Vector3): void {
    const { w, d } = HAB;
    p.x = Math.max(-w / 2 + 0.4, Math.min(w / 2 - 0.4, p.x));
    p.z = Math.max(-d / 2 + 0.4, Math.min(d / 2 - 0.4, p.z));
    for (const c of this.colliders) resolveCircle(p, 0.32, c);
  }

  tick(now: number): void {
    this.lamp.intensity = 8 + Math.sin(now / 1900) * 0.15;
  }
}
