// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * First-person view: the suit body is hidden (nothing clips the lens); instead a gloved
 * hand holds the field scanner, whose screen shows the live Sun / Earth status computed
 * by the science engine for where you stand. Original procedural model.
 */

import * as THREE from "three";

export class Handheld {
  readonly group = new THREE.Group();
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private sway = 0;

  constructor() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 320;
    this.ctx = c.getContext("2d") as CanvasRenderingContext2D;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const body = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.5 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd8642e, roughness: 0.6 });
    const glove = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.85 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x8b9097, roughness: 0.4, metalness: 0.6 });
    // scanner body
    const dev = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.11, 0.022), body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.145, 0.09), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    screen.position.z = 0.0115;
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.176, 0.008, 0.026), trim);
    bumper.position.y = 0.058;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.1, 10), body);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, -0.068, -0.006);
    const device = new THREE.Group();
    device.add(dev, screen, bumper, handle);
    // gloved hand around the handle: palm + four fingers + thumb, then wrist cuff and sleeve
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.06), glove);
    palm.position.set(0.03, -0.085, -0.02);
    hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.03, 4, 8), glove);
      f.rotation.x = Math.PI / 2;
      f.position.set(0.0 + i * 0.018, -0.07, 0.006);
      hand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 4, 8), glove);
    thumb.rotation.z = 0.9;
    thumb.position.set(-0.02, -0.062, 0.004);
    hand.add(thumb);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.04, 16), cuff);
    wrist.rotation.x = Math.PI / 2.4;
    wrist.position.set(0.05, -0.11, -0.07);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.22, 16), glove);
    sleeve.rotation.x = Math.PI / 2.4;
    sleeve.position.set(0.07, -0.15, -0.18);
    hand.add(wrist, sleeve);
    this.group.add(device, hand);
    this.group.position.set(0.23, -0.2, -0.5);
    this.group.rotation.set(0.25, -0.4, 0.06);
    this.group.scale.setScalar(0.85);
    this.group.traverse((o) => {
      (o as THREE.Mesh).castShadow = false;
      o.renderOrder = 5;
    });
    this.draw({ sun: "—", sunOk: false, earth: "—", earthOk: false, place: "" });
  }

  draw(s: { sun: string; sunOk: boolean; earth: string; earthOk: boolean; place: string }): void {
    const g = this.ctx;
    g.fillStyle = "#06080b";
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = "rgba(111,168,220,0.07)";
    for (let y = 0; y < 320; y += 4) g.fillRect(0, y, 512, 1);
    g.fillStyle = "#f2b544";
    g.font = "700 30px Inter, system-ui, sans-serif";
    g.fillText("FIELD SCANNER", 24, 46);
    g.fillStyle = "rgba(236,230,218,0.6)";
    g.font = "500 22px Inter, system-ui, sans-serif";
    g.fillText(s.place, 24, 78);
    const row = (y: number, label: string, val: string, ok: boolean, col: string): void => {
      g.fillStyle = ok ? col : "#ff8c73";
      g.beginPath();
      g.arc(38, y - 10, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ece6da";
      g.font = "600 30px Inter, system-ui, sans-serif";
      g.fillText(label, 62, y);
      g.textAlign = "right";
      g.fillStyle = ok ? col : "#ff9b82";
      g.font = "700 30px Inter, system-ui, sans-serif";
      g.fillText(val, 490, y);
      g.textAlign = "left";
    };
    row(150, "Sun", s.sun, s.sunOk, "#ffd27a");
    row(215, "Earth", s.earth, s.earthOk, "#a9cdf0");
    g.fillStyle = "rgba(236,230,218,0.5)";
    g.font = "500 20px Inter, system-ui, sans-serif";
    g.fillText("M · full scanner", 24, 290);
    this.tex.needsUpdate = true;
  }

  /** Gentle sway with walking (visual only). */
  update(dt: number, speed: number, stride: number, pitch: number): void {
    this.sway += dt;
    const k = Math.min(1, speed / 3);
    this.group.position.x = 0.23 + Math.sin(stride * 1.1) * 0.008 * k;
    this.group.position.y = -0.2 + Math.abs(Math.cos(stride * 1.1)) * 0.01 * k + Math.sin(this.sway * 1.3) * 0.002 - Math.max(0, -pitch) * 0.02;
  }
}
