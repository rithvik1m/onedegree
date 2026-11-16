// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Mission Control interior (fictional set, original procedural geometry).
 * One room: a curved console with three live screens fed by the science engine,
 * equipment racks, a porthole, and the airlock door. The console opens the planner.
 */

import * as THREE from "three";
import type { Interactable } from "./outpost";

export const ROOM = { w: 10, d: 6.4, h: 3.0 };

function canvasTex(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D; t: THREE.CanvasTexture } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, g, t };
}

function panelTexture(): THREE.Texture {
  const { g, t } = canvasTex(512, 512);
  g.fillStyle = "#cfcac0";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 3;
  for (let i = 0; i <= 512; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let x = 12; x < 512; x += 128) for (let y = 12; y < 512; y += 128) {
    for (const [dx, dy] of [[0, 0], [104, 0], [0, 104], [104, 104]]) { g.beginPath(); g.arc(x + (dx as number), y + (dy as number), 3, 0, 7); g.fill(); }
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function floorTexture(): THREE.Texture {
  const { g, t } = canvasTex(256, 256);
  g.fillStyle = "#2a2c30";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#1c1d20";
  for (let x = 0; x < 256; x += 16) for (let y = 0; y < 256; y += 16) if ((x + y) % 32 === 0) g.fillRect(x + 2, y + 2, 12, 12);
  g.strokeStyle = "rgba(242,181,68,0.35)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 3);
  return t;
}

export interface Screen { draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; w: number; h: number }

export class Interior {
  readonly scene = new THREE.Scene();
  readonly interactables: Interactable[] = [];
  readonly screens: Screen[] = [];
  readonly entry = { x: 0, z: 2.3, yaw: 0 };
  private leds: THREE.Mesh[] = [];

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x050506);
    const { w, d, h } = ROOM;
    const panel = panelTexture();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: panel, roughness: 0.75, metalness: 0.05 });
    (wallMat.map as THREE.Texture).repeat.set(3, 1);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.6, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    // walls
    const wall = (ww: number, x: number, z: number, ry: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, h), wallMat);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      s.add(m);
    };
    wall(w, 0, -d / 2, 0);
    wall(w, 0, d / 2, Math.PI);
    wall(d, -w / 2, 0, Math.PI / 2);
    wall(d, w / 2, 0, -Math.PI / 2);
    // ceiling with light strips
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.85 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h;
    s.add(ceil);
    const strip = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    for (const z of [-1.4, 1.4]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.03, 0.14), strip);
      l.position.set(0, h - 0.02, z);
      s.add(l);
    }
    s.add(new THREE.AmbientLight(0xbfc6d4, 0.55));
    const p1 = new THREE.PointLight(0xfff0d8, 9, 14, 1.6);
    p1.position.set(-2.5, h - 0.3, 0);
    const p2 = p1.clone();
    p2.position.x = 2.5;
    s.add(p1, p2);
    const screenGlow = new THREE.PointLight(0x7fc4ff, 3, 6, 2);
    screenGlow.position.set(0, 1.4, -1.6);
    s.add(screenGlow);

    // console: curved desk facing the front wall
    const desk = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.08, 48, 1, false, Math.PI * 0.72, Math.PI * 0.56), new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.4, metalness: 0.5 }));
    desk.position.set(0, 0.86, 0.6);
    s.add(desk);
    const deskBody = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 0.86, 48, 1, true, Math.PI * 0.72, Math.PI * 0.56), new THREE.MeshStandardMaterial({ color: 0x3a3d43, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
    deskBody.position.set(0, 0.43, 0.6);
    s.add(deskBody);
    // three screens on arms above the desk
    const screenDefs = [
      { x: -1.55, ry: 0.42, w: 1.25, h: 0.78 },
      { x: 0, ry: 0, w: 1.55, h: 0.92 },
      { x: 1.55, ry: -0.42, w: 1.25, h: 0.78 },
    ];
    for (const sd of screenDefs) {
      const { c, g, t } = canvasTex(1024, Math.round((1024 * sd.h) / sd.w));
      const frame = new THREE.Mesh(new THREE.BoxGeometry(sd.w + 0.06, sd.h + 0.06, 0.05), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.6 }));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(sd.w, sd.h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
      scr.position.z = 0.03;
      const grp = new THREE.Group();
      grp.add(frame, scr);
      const z = -2.55 + Math.abs(sd.x) * 0.38;
      grp.position.set(sd.x, 1.62, z);
      grp.rotation.y = sd.ry;
      s.add(grp);
      this.screens.push({ draw: () => undefined, tex: t, g, w: c.width, h: c.height });
    }
    // keyboard slab + chair
    const kb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.35), new THREE.MeshStandardMaterial({ color: 0x1f2125, roughness: 0.5 }));
    kb.position.set(0, 0.92, -0.1);
    s.add(kb);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0xd8642e, roughness: 0.7 }));
    seat.position.set(0.9, 0.5, 0.8);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), seat.material);
    back.position.set(0.9, 0.85, 1.08);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x8b9097, metalness: 0.8, roughness: 0.3 }));
    post.position.set(0.9, 0.25, 0.8);
    s.add(seat, back, post);
    // equipment racks with LEDs
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.5, metalness: 0.4 });
    for (const x of [-4.4, 4.4]) {
      for (const z of [-1.6, 0.2]) {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 1.4), rackMat);
        rack.position.set(x, 1.1, z);
        s.add(rack);
        for (let i = 0; i < 18; i++) {
          const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.05), new THREE.MeshBasicMaterial({ color: i % 5 === 0 ? 0xf2b544 : i % 3 === 0 ? 0x6fe0cf : 0x6fa8dc }));
          led.position.set(x - Math.sign(x) * 0.46, 0.4 + (i % 9) * 0.18, z - 0.4 + Math.floor(i / 9) * 0.8);
          s.add(led);
          this.leds.push(led);
        }
      }
    }
    // porthole on the left wall: black space with a few stars (it faces away from the Sun)
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.45, 40), new THREE.MeshBasicMaterial({ color: 0x020203 }));
    port.position.set(-w / 2 + 0.02, 1.7, 2.0);
    port.rotation.y = Math.PI / 2;
    s.add(port);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.05, 10, 40), new THREE.MeshStandardMaterial({ color: 0x8b9097, metalness: 0.8, roughness: 0.3 }));
    ring.position.copy(port.position);
    ring.rotation.y = Math.PI / 2;
    s.add(ring);
    // airlock door (back wall)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x3a3d43, metalness: 0.5, roughness: 0.4 }));
    door.position.set(0, 1.05, d / 2 - 0.05);
    s.add(door);
    for (const sx of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
      l.position.set(sx * 0.7, 1.05, d / 2 - 0.06);
      s.add(l);
    }
    // sign
    const { g, t } = canvasTex(1024, 128);
    g.fillStyle = "#0b0b0c";
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = "#f2b544";
    g.font = "700 46px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("MISSION CONTROL · OUTPOST (SIMULATED)", 512, 80);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    sign.position.set(0, 2.62, -d / 2 + 0.02);
    s.add(sign);

    this.interactables.push(
      { id: "console", label: "Use the planning console · compare sites & dates", x: 0, z: 0.25, r: 1.4 },
      { id: "exit", label: "Exit to the surface", x: 0, z: d / 2 - 0.7, r: 1.0 },
    );
  }

  /** Keep the player inside the room and out of the desk. */
  clamp(p: THREE.Vector3): void {
    const { w, d } = ROOM;
    p.x = Math.max(-w / 2 + 1.1, Math.min(w / 2 - 1.1, p.x));
    p.z = Math.max(-d / 2 + 0.4, Math.min(d / 2 - 0.35, p.z));
    // desk: a ring segment around (0, 0.6) radius ~3.2 in front of the player
    const dx = p.x, dz = p.z - 0.6;
    const r = Math.hypot(dx, dz);
    if (dz < 0 && r > 2.75 && r < 3.6) {
      const k = 2.75 / r;
      p.x = dx * k;
      p.z = 0.6 + dz * k;
    }
  }

  tick(now: number): void {
    for (let i = 0; i < this.leds.length; i++) (this.leds[i] as THREE.Mesh).visible = Math.sin(now / (300 + (i % 7) * 90) + i) > -0.6;
  }

  /** Redraw a screen with a title and lines of text (and an optional image). */
  setScreen(i: number, title: string, lines: [string, string, string?][], img?: CanvasImageSource): void {
    const sc = this.screens[i];
    if (!sc) return;
    const g = sc.g, W = sc.w, H = sc.h;
    g.fillStyle = "#06080b";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(111,168,220,0.08)";
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    g.fillStyle = "#f2b544";
    g.font = "700 40px Inter, system-ui, sans-serif";
    g.fillText(title, 40, 70);
    if (img) {
      const s = Math.min(W - 80, H - 120);
      g.drawImage(img, (W - s) / 2, 100, s, s);
    }
    let y = img ? H - 20 - lines.length * 52 : 140;
    for (const [k, v, col] of lines) {
      g.fillStyle = "rgba(236,230,218,0.7)";
      g.font = "500 30px Inter, system-ui, sans-serif";
      g.fillText(k, 40, y);
      g.fillStyle = col ?? "#ece6da";
      g.font = "700 40px 'JetBrains Mono', ui-monospace, monospace";
      g.textAlign = "right";
      g.fillText(v, W - 40, y);
      g.textAlign = "left";
      y += 58;
    }
    sc.tex.needsUpdate = true;
  }
}
