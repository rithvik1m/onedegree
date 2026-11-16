// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Orbit view for spacecraft flight: the whole Moon at true scale (km units, Moon-fixed
 * frame, z = north), textured with NASA's LRO LROC WAC colour mosaic (NASA SVS CGI Moon
 * Kit), lit by the Sun and with the Earth placed from the NASA/JPL Horizons table.
 * Shares the surface renderer (one WebGL context on an 8 GB laptop).
 */
import * as THREE from "three";
import { GM, R_MOON, lonLatOf, type Craft } from "./sim";
import { buildLander } from "../surface/outpost";

const KM = 1000;
const R_KM = R_MOON / KM;

export interface MapMarker {
  id: string;
  label: string;
  lon: number;
  lat: number;
  kind: string;
  groundM?: number;
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.font = "600 26px system-ui, sans-serif";
  const w = Math.ceil(ctx.measureText(text).width) + 30;
  c.width = w;
  c.height = 40;
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.fillStyle = "rgba(10,12,14,0.72)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 40, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(14, 20, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f2efe8";
  ctx.fillText(text, 26, 29);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
  s.scale.set((w / 40) * 0.032, 0.032, 1);
  s.center.set(0.08, -0.25);
  s.renderOrder = 10;
  return s;
}

const KIND_COLOR: Record<string, string> = { base: "#ffb347", historic: "#f2efe8", survey: "#6fe0cf", mission: "#6fa8dc", custom: "#e07fd8", dest: "#7fe0a0" };

export class OrbitView {
  readonly scene = new THREE.Scene();
  private near = new THREE.Scene();
  readonly camFar = new THREE.PerspectiveCamera(55, 1, 1, 2e6);
  readonly camNear = new THREE.PerspectiveCamera(55, 1, 0.0004, 8);
  private sun = new THREE.DirectionalLight(0xffffff, 3.2);
  private sunNear = new THREE.DirectionalLight(0xffffff, 3.2);
  private earth: THREE.Mesh;
  private craft: THREE.Group;
  private traj: THREE.Line;
  private impact: THREE.Mesh;
  private dest: THREE.Group;
  private markers: { m: MapMarker; s: THREE.Sprite; p: THREE.Vector3 }[] = [];
  camYaw = 0.6;
  camPitch = 0.35;
  camDist = 0.045; // km
  private trajT = 0;
  private texLoaded = false;

  constructor() {
    this.scene.background = new THREE.Color(0x000000);
    const tex = new THREE.TextureLoader().load("textures/moon_lroc_4096.jpg", () => { this.texLoaded = true; });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const moon = new THREE.Mesh(new THREE.SphereGeometry(R_KM, 256, 128), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    moon.rotation.x = Math.PI / 2; // three's sphere pole (y) → Moon-fixed z; u = 0.5 lands on 0° longitude
    this.scene.add(moon);
    const etex = new THREE.TextureLoader().load("textures/earth_bluemarble_2048.jpg");
    etex.colorSpace = THREE.SRGBColorSpace;
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(6371, 64, 32), new THREE.MeshStandardMaterial({ map: etex, roughness: 0.8 }));
    this.earth.rotation.x = Math.PI / 2;
    this.scene.add(this.earth);
    this.scene.add(this.sun, new THREE.AmbientLight(0xffffff, 0.035));
    // stars
    const n = 2600;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(t) * 1.5e6, r * Math.sin(t) * 1.5e6, z * 1.5e6], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd6e6, size: 1.4, sizeAttenuation: false }));
    stars.frustumCulled = false;
    this.scene.add(stars);
    // predicted trajectory (gravity only, no thrust)
    this.traj = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 }));
    this.traj.frustumCulled = false;
    this.scene.add(this.traj);
    this.impact = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4a }));
    this.impact.visible = false;
    this.scene.add(this.impact);
    // destination marker
    this.dest = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 48), new THREE.MeshBasicMaterial({ color: 0x7fe0a0 }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fe0a0, transparent: true, opacity: 0.45, depthWrite: false }));
    beam.rotation.x = Math.PI / 2;
    beam.position.z = 30;
    ring.name = "ring";
    this.dest.add(ring, beam);
    this.dest.visible = false;
    this.scene.add(this.dest);
    // the craft (metres → km)
    this.craft = buildLander();
    this.craft.scale.setScalar(1 / KM);
    this.near.add(this.craft, this.sunNear, new THREE.AmbientLight(0xffffff, 0.12));
  }

  get ready(): boolean {
    return this.texLoaded;
  }

  setSky(sunDir: THREE.Vector3, earthKm: THREE.Vector3): void {
    this.sun.position.copy(sunDir).multiplyScalar(1e5);
    this.sunNear.position.copy(sunDir).multiplyScalar(10);
    this.earth.position.copy(earthKm);
  }

  setMarkers(list: MapMarker[]): void {
    for (const k of this.markers) { this.scene.remove(k.s); k.s.material.map?.dispose(); k.s.material.dispose(); }
    this.markers = list.map((m) => {
      const s = labelSprite(m.label, KIND_COLOR[m.kind] ?? "#ffffff");
      const u = new THREE.Vector3(Math.cos(m.lat * Math.PI / 180) * Math.cos(m.lon * Math.PI / 180), Math.cos(m.lat * Math.PI / 180) * Math.sin(m.lon * Math.PI / 180), Math.sin(m.lat * Math.PI / 180));
      const p = u.multiplyScalar(R_KM + (m.groundM ?? 0) / KM + 0.3);
      s.position.copy(p);
      this.scene.add(s);
      return { m, s, p };
    });
  }

  setDestination(r: THREE.Vector3 | null): void {
    this.dest.visible = !!r;
    if (!r) return;
    const p = r.clone().divideScalar(KM);
    this.dest.position.copy(p);
    this.dest.lookAt(p.clone().multiplyScalar(2));
  }

  private updateTrajectory(c: Craft): void {
    const r = c.r.clone(), v = c.v.clone();
    const pts: number[] = [r.x / KM, r.y / KM, r.z / KM];
    const rn0 = r.length();
    const T = Math.min(3 * 3600, Math.max(600, 2 * Math.PI * Math.sqrt(rn0 ** 3 / GM)));
    const dt = 8;
    let hit = false;
    const a = new THREE.Vector3();
    for (let t = 0; t < T; t += dt) {
      const n = r.length();
      a.copy(r).multiplyScalar(-GM / (n * n * n));
      v.addScaledVector(a, dt);
      r.addScaledVector(v, dt);
      if (r.length() < R_MOON) { hit = true; break; }
      if (pts.length % 6 === 0) pts.push(r.x / KM, r.y / KM, r.z / KM);
    }
    pts.push(r.x / KM, r.y / KM, r.z / KM);
    this.traj.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.traj.geometry = g;
    this.impact.visible = hit;
    if (hit) this.impact.position.copy(r).setLength(R_KM);
  }

  render(renderer: THREE.WebGLRenderer, c: Craft, now: number, plume: number, aspect: number, cockpit = false): void {
    const cp = c.r.clone().divideScalar(KM);
    // chase camera around the craft, in the craft's local horizon frame
    const up = cp.clone().normalize();
    const north = new THREE.Vector3(0, 0, 1).addScaledVector(up, -up.z).normalize();
    const east = north.clone().cross(up).normalize();
    const vH = c.v.clone().addScaledVector(up, -c.v.dot(up));
    const back = vH.lengthSq() > 100 ? vH.clone().normalize().negate() : new THREE.Vector3(0, 0, 1).applyQuaternion(c.q).addScaledVector(up, -0).normalize();
    const side = up.clone().cross(back).normalize();
    void east;
    const dir = back.clone().applyAxisAngle(up, this.camYaw).multiplyScalar(Math.cos(this.camPitch)).addScaledVector(up, Math.sin(this.camPitch)).normalize();
    void side;
    const camPos = cockpit ? new THREE.Vector3(0, 5.75, -1.2).applyQuaternion(c.q).divideScalar(KM).add(cp) : cp.clone().addScaledVector(dir, this.camDist);
    for (const cam of [this.camFar, this.camNear]) {
      cam.aspect = aspect;
      cam.position.copy(camPos);
      if (cockpit) {
        cam.quaternion.copy(c.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.34 + this.camPitch * 0.4, this.camYaw * 0.6, 0, "YXZ")));
      } else {
        cam.up.copy(up);
        cam.lookAt(cp);
      }
    }
    this.craft.visible = !cockpit;
    const alt = cp.length() - R_KM;
    this.camFar.near = Math.max(0.01, Math.min(this.camDist * 0.4, alt * 0.4, 50));
    this.camFar.far = 2e6;
    this.camNear.far = Math.max(1, this.camDist * 3);
    this.camFar.updateProjectionMatrix();
    this.camNear.updateProjectionMatrix();
    this.craft.position.copy(cp);
    this.craft.quaternion.copy(c.q);
    const pl = this.craft.getObjectByName("plume") as THREE.Mesh;
    const core = this.craft.getObjectByName("plumeCore") as THREE.Mesh;
    for (const m of [pl, core]) {
      m.visible = plume > 0.02;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.75, plume * (0.6 + 0.15 * Math.sin(now / 37)));
      m.scale.set(1, 0.5 + plume * 0.8, 1);
    }
    if (now - this.trajT > 400) { this.trajT = now; this.updateTrajectory(c); }
    // destination ring size scales with the view
    const ring = this.dest.getObjectByName("ring") as THREE.Mesh;
    const dd = this.dest.position.distanceTo(camPos);
    ring.scale.setScalar(Math.max(0.2, dd * 0.02) * (1 + 0.1 * Math.sin(now / 250)));
    // hide labels behind the Moon's limb
    for (const k of this.markers) {
      const toM = k.p.clone().sub(camPos);
      const L = toM.length();
      const d = toM.divideScalar(L);
      const b = camPos.dot(d);
      const cc = camPos.lengthSq() - R_KM * R_KM;
      const disc = b * b - cc;
      const tHit = disc > 0 ? -b - Math.sqrt(disc) : Infinity;
      k.s.visible = !(tHit > 0 && tHit < L - 1);
    }
    renderer.clear();
    renderer.render(this.scene, this.camFar);
    renderer.clearDepth();
    renderer.render(this.near, this.camNear);
  }

  /** Sub-craft point (lon, lat) for the HUD. */
  static where(c: Craft): [number, number] {
    return lonLatOf(c.r);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }
    });
  }
}
