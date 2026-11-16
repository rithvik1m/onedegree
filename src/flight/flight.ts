// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Pilotable OD-1 spacecraft. One Moon-centred flight state (src/flight/sim.ts) drives two
 * views: the local surface scene (NASA LOLA terrain, below ~14 km) and the whole-Moon
 * orbit view above it. Explorer mode = assisted, game-style flight (see sim.ts header).
 */
import * as THREE from "three";
import { A_MAX, GM, R_MOON, SceneFrame, bodyUp, guidance, holdVertical, lonLatOf, orbitOf, rangeBearing, steerAndThrust, stepRotation, stepTranslation, type Craft } from "./sim";
import { OrbitView, type MapMarker } from "./orbitView";
import { shared } from "../surface/materials";
import type { SurfaceWorld } from "../surface/world";

const D2R = Math.PI / 180;
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export interface FlightDest {
  id: string;
  name: string;
  r: THREE.Vector3; // landing point, Moon-fixed metres
}

export interface FlightHost {
  world: SurfaceWorld;
  /** frame of the region currently loaded in the surface world */
  frame(): SceneFrame | null;
  destination(): FlightDest | null;
  /** load the region for a landing near (lon, lat); resolves when the surface world holds it */
  ensureRegion(lon: number, lat: number): Promise<void>;
  sky(): { sun: THREE.Vector3; earthKm: THREE.Vector3 } | null;
  markers(): MapMarker[];
  onLanded(info: { vTouch: number; regionId: string }): void;
  onExit(pos: THREE.Vector3, yaw: number): void;
  onPhase(phase: "surface" | "orbit"): void;
  openMap(): void;
  toast(msg: string, ms?: number): void;
}

type Auto = null | "land" | "orbit" | "brake";
const WARPS = [1, 5, 20, 50];

export class Flight {
  active = false;
  phase: "surface" | "orbit" = "surface";
  landed = true;
  mode: "explorer" | "manual" = "explorer";
  auto: Auto = null;
  cockpit = false;
  warp = 1;
  private c: Craft = { r: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), thrust: 0, dv: 0 };
  private vzT = 0;
  private throttle = 0;
  private keys = new Set<string>();
  private frame: SceneFrame | null = null;
  private view: OrbitView | null = null;
  private camYaw = 0;
  private camPitch = 0.32;
  private camDist = 26; // m
  private regionPending = false;
  private lastPhaseCheck = 0;
  private hudT = 0;
  private gPhase = "";
  private lastDist = 0;
  private tmp = new THREE.Vector3();
  private drag: { id: number; x: number; y: number } | null = null;
  private plume = 0;
  private boardedAt = 0;
  private camHeading = 0;
  private askedFor = "";

  constructor(private host: FlightHost) {
    window.addEventListener("keydown", (e) => this.onKey(e, true), true);
    window.addEventListener("keyup", (e) => this.onKey(e, false), true);
    window.addEventListener("blur", () => this.keys.clear());
    const el = host.world.renderer.domElement;
    el.addEventListener("pointerdown", (e) => { if (this.active) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    window.addEventListener("pointermove", (e) => {
      if (!this.active || !this.drag || e.pointerId !== this.drag.id) return;
      this.camYaw -= (e.clientX - this.drag.x) * 0.006;
      this.camPitch = Math.max(-1.2, Math.min(1.45, this.camPitch + (e.clientY - this.drag.y) * 0.005));
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    window.addEventListener("pointerup", () => { this.drag = null; });
    el.addEventListener("wheel", (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.camDist = Math.max(9, Math.min(2.5e6, this.camDist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
  }

  get craft(): Craft {
    return this.c;
  }

  // ---------- boarding ----------
  board(): boolean {
    const w = this.host.world;
    const f = this.host.frame();
    const obj = w.landerObj;
    if (!f || !obj) return false;
    this.frame = f;
    this.c.r = f.fromScene(obj.position.clone());
    this.c.v.set(0, 0, 0);
    this.c.w.set(0, 0, 0);
    this.c.q = f.quatFromScene(obj.quaternion.clone());
    this.c.thrust = 0;
    this.landed = true;
    this.phase = "surface";
    this.auto = null;
    this.vzT = 0;
    this.throttle = 0;
    this.warp = 1;
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.camDist = 26;
    const fq = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
    this.camHeading = Math.atan2(fq.x, -fq.z);
    this.active = true;
    this.boardedAt = performance.now();
    this.askedFor = "";
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    w.flight = { tick: (dt) => this.tick(dt), renderOrbit: (r) => this.renderOrbit(r) };
    document.body.classList.add("flying");
    $("flightHud").classList.remove("hidden");
    this.host.toast("Aboard OD-1. <b>Shift</b> climb · <b>W/A/S/D</b> tilt/turn · <b>L</b> autopilot to your destination · <b>G</b> map · <b>E</b> exit when landed.", 7000);
    return true;
  }

  exit(): void {
    if (!this.landed || !this.frame) return;
    const w = this.host.world;
    const obj = w.landerObj;
    const pos = obj ? obj.position.clone() : this.frame.toScene(this.c.r);
    const qS = this.frame.quatToScene(this.c.q);
    const hatch = new THREE.Vector3(-1, 0, 0).applyQuaternion(qS);
    hatch.y = 0;
    hatch.normalize();
    const p = pos.clone().addScaledVector(hatch, 5.4);
    const yaw = Math.atan2(hatch.x, -hatch.z);
    this.active = false;
    w.flight = null;
    document.body.classList.remove("flying", "cockpit");
    $("flightHud").classList.add("hidden");
    shared.sunGate.value = 1;
    this.host.onExit(p, yaw);
  }

  // ---------- input ----------
  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.active || (e.target as HTMLElement)?.closest?.("input, select, textarea, dialog")) return;
    const k = e.code;
    const handled = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "Space", "KeyX", "KeyL", "KeyO", "KeyT", "KeyC", "KeyF", "KeyR", "KeyM", "KeyG", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!handled.includes(k)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!down) { this.keys.delete(k); return; }
    if (e.repeat && !["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(k)) return;
    this.keys.add(k);
    if (k === "KeyE" && this.landed && !this.auto) { if (performance.now() - this.boardedAt > 500) this.exit(); return; }
    if (k === "KeyL") this.toggleAuto("land");
    else if (k === "KeyO") this.toggleAuto("orbit");
    else if (k === "KeyX") { this.vzT = 0; this.throttle = 0; this.host.toast(this.mode === "explorer" ? "Hold: vertical speed 0" : "Throttle cut", 1600); }
    else if (k === "KeyT") this.cycleWarp();
    else if (k === "KeyC") { this.cockpit = !this.cockpit; document.body.classList.toggle("cockpit", this.cockpit); }
    else if (k === "KeyF") { this.mode = this.mode === "explorer" ? "manual" : "explorer"; this.throttle = this.c.thrust / A_MAX; this.vzT = 0; this.host.toast(this.mode === "explorer" ? "EXPLORER: assisted flight — Shift/Ctrl set climb rate, the computer holds it." : "MANUAL: Shift/Ctrl set raw throttle; no vertical hold. Gravity is real.", 4200); }
    else if (k === "KeyM" || k === "KeyG") this.host.openMap();
  }

  private toggleAuto(a: Exclude<Auto, null | "brake">): void {
    if (this.auto === a) { this.auto = null; this.vzT = 0; this.host.toast("Autopilot off — you have control.", 2000); return; }
    if (a === "land" && !this.host.destination()) { this.host.toast("No destination. Press <b>G</b> to open the Moon map and pick one.", 3800); return; }
    this.auto = a;
    this.host.toast(a === "land" ? `Autopilot: flying to <b>${this.host.destination()?.name}</b> and landing (assisted guidance). L again to take over.` : "Orbit assist: climbing to a 60 km circular orbit. O again to take over.", 4200);
  }

  private cycleWarp(): void {
    if (this.agl() < 3000 || this.landed) { this.warp = 1; this.host.toast("Time warp needs at least 3 km of height.", 2000); return; }
    const i = WARPS.indexOf(this.warp);
    this.warp = WARPS[(i + 1) % WARPS.length] as number;
    this.host.toast(`Time warp ×${this.warp} — time compressed, physics unchanged.`, 2000);
  }

  // ---------- helpers ----------
  private up(): THREE.Vector3 {
    return this.c.r.clone().normalize();
  }
  /** height above the ground under the craft (surface) or above mean radius (orbit) */
  agl(): number {
    if (this.phase === "surface" && this.frame) {
      const p = this.frame.toScene(this.c.r, this.tmp);
      return p.y - this.host.world.groundAt(p.x, p.z);
    }
    return this.c.r.length() - R_MOON;
  }
  private clearanceAboveTarget(dest: FlightDest | null): number {
    if (this.phase !== "surface" || !this.frame || !dest) return -Infinity;
    const w = this.host.world;
    const tr = dest.r.length();
    let hi = -Infinity;
    const p = this.frame.toScene(this.c.r);
    const vS = this.frame.dirToScene(this.c.v);
    for (const s of [0, 4, 10, 20]) {
      const x = p.x + vS.x * s, z = p.z + vS.z * s;
      const g = w.groundAt(x, z);
      const r = this.frame.fromScene(new THREE.Vector3(x, g, z)).length();
      hi = Math.max(hi, r - tr);
    }
    return hi;
  }

  // ---------- simulation ----------
  private tick(dt: number): "surface" | "orbit" {
    const k = this.keys;
    const inp = (a: string, b: string): number => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    const pitchIn = inp("KeyS", "KeyW") + inp("ArrowDown", "ArrowUp");
    const yawIn = inp("KeyA", "KeyD") + inp("ArrowLeft", "ArrowRight");
    const rollIn = this.landed ? 0 : inp("KeyQ", "KeyE");
    const manualRot = pitchIn !== 0 || yawIn !== 0 || rollIn !== 0;
    if (manualRot && this.auto === "land") { this.auto = null; this.host.toast("Autopilot off — manual attitude.", 1800); }
    // climb / throttle
    const thrIn = (k.has("ShiftLeft") || k.has("ShiftRight") ? 1 : 0) - (k.has("ControlLeft") || k.has("ControlRight") ? 1 : 0);
    if (thrIn && this.auto) { this.auto = null; }
    if (this.mode === "explorer") this.vzT = Math.max(-150, Math.min(150, this.vzT + thrIn * 14 * dt));
    else this.throttle = Math.max(0, Math.min(1, this.throttle + thrIn * 0.6 * dt));
    const braking = k.has("Space");
    // warp limits
    if ((!this.auto && this.agl() < 3000) || this.landed) this.warp = 1;
    const dest = this.host.destination();
    let warp = this.warp;
    if (this.auto && !this.landed) {
      const gp = this.auto === "land" && dest ? guidance(this.c, dest, 60_000) : guidance(this.c, null, 60_000);
      warp = gp.warp;
      if (this.phase === "surface" && this.agl() < 600) warp = 1;
      this.warp = warp;
    }
    const simDt = dt * warp;
    const n = Math.max(1, Math.ceil(simDt / 0.05));
    const h = simDt / n;
    // attitude from keys (real time), autopilots steer per substep
    if (!this.auto) {
      const tgt = new THREE.Vector3(pitchIn * 40 * D2R, yawIn * 50 * D2R, rollIn * 40 * D2R);
      this.c.w.lerp(tgt, Math.min(1, dt / 0.2));
      if (k.has("KeyR") && !this.landed) this.level(dt);
      else if (!this.landed) stepRotation(this.c, dt);
    }
    for (let i = 0; i < n; i++) {
      let thrust = 0;
      if (this.auto === "land" && dest) {
        const g = guidance(this.c, dest, 60_000, () => this.clearanceAboveTarget(dest));
        this.gPhase = g.phase;
        this.lastDist = g.dist;
        thrust = steerAndThrust(this.c, g.acc, h);
      } else if (this.auto === "orbit") {
        const g = guidance(this.c, null, 60_000);
        this.gPhase = "orbit";
        thrust = steerAndThrust(this.c, g.acc, h);
        const o = orbitOf(this.c.r, this.c.v);
        if (o.periAlt > 45_000 && o.apoAlt < 80_000) { this.auto = null; this.vzT = 0; this.mode === "explorer" && (this.throttle = 0); this.host.toast(`Orbit reached: ${(o.periAlt / 1000).toFixed(0)} × ${(o.apoAlt / 1000).toFixed(0)} km, period ${(o.period / 60).toFixed(0)} min. Engine off — you are falling around the Moon.`, 6000); this.coast = true; }
      } else if (braking && !this.landed) {
        const up = this.up();
        const vUp = this.c.v.dot(up);
        const vH = this.c.v.clone().addScaledVector(up, -vUp);
        const rn = this.c.r.length();
        const want = vH.multiplyScalar(-1 / 3).addScaledVector(up, GM / (rn * rn) - (this.c.v.lengthSq() - vUp * vUp) / rn + (this.vzT - vUp) / 1.5);
        if (want.length() > A_MAX) want.setLength(A_MAX);
        thrust = steerAndThrust(this.c, want, h, 60 * D2R);
      } else if (this.mode === "explorer") {
        thrust = this.coast && this.vzT === 0 && thrIn === 0 ? 0 : holdVertical(this.c, this.vzT);
        if (thrIn !== 0) this.coast = false;
      } else thrust = this.throttle * A_MAX;
      this.c.thrust = thrust;
      if (this.landed) {
        // lift off only when the engine beats local gravity
        const g0 = GM / this.c.r.lengthSq();
        if (thrust * bodyUp(this.c.q).dot(this.up()) <= g0 * 1.02) { this.c.v.set(0, 0, 0); continue; }
        this.landed = false;
        this.host.toast("Liftoff.", 1500);
      }
      stepTranslation(this.c, h);
      if (this.contact()) break;
    }
    this.plume += ((this.c.thrust / A_MAX) - this.plume) * Math.min(1, dt * 10);
    this.updatePhase();
    if (this.phase === "surface") this.placeSurface(dt);
    this.updateHud();
    return this.phase;
  }
  private coast = false;

  private level(dt: number): void {
    const up = this.up();
    const cur = bodyUp(this.c.q);
    const axis = cur.clone().cross(up);
    const s = axis.length();
    if (s < 1e-6) return;
    const ang = Math.atan2(s, cur.dot(up));
    const dq = new THREE.Quaternion().setFromAxisAngle(axis.divideScalar(s), Math.min(ang, 60 * D2R * dt));
    this.c.q.premultiply(dq).normalize();
    this.c.w.set(0, 0, 0);
  }

  /** ground contact in the surface phase */
  private contact(): boolean {
    if (this.phase !== "surface" || !this.frame) {
      // no local terrain loaded: never let the craft sink below the mean sphere
      const h = this.c.r.length() - R_MOON;
      if (h < 500 && !this.landed) {
        const up = this.up();
        const vUp = this.c.v.dot(up);
        if (vUp < 0) this.c.v.addScaledVector(up, -vUp);
      }
      return false;
    }
    const p = this.frame.toScene(this.c.r);
    const g = this.host.world.groundAt(p.x, p.z);
    if (p.y > g) return false;
    const vTouch = Math.abs(this.c.v.dot(this.up()));
    p.y = g;
    this.c.r = this.frame.fromScene(p);
    this.c.v.set(0, 0, 0);
    this.c.w.set(0, 0, 0);
    this.c.thrust = 0;
    // settle upright, keep heading
    const qS = this.frame.quatToScene(this.c.q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(qS);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.c.q = this.frame.quatFromScene(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    this.landed = true;
    const wasAuto = this.auto;
    this.auto = null;
    this.vzT = 0;
    this.throttle = 0;
    this.warp = 1;
    this.coast = false;
    this.host.toast(`Touchdown at ${vTouch.toFixed(1)} m/s${vTouch > 3 ? " — hard landing (Explorer gear absorbs it)" : ""}. <b>E</b> to step out${wasAuto ? "" : ""}.`, 4500);
    this.host.onLanded({ vTouch, regionId: this.host.world.patch?.id ?? "" });
    return true;
  }

  private updatePhase(): void {
    const now = performance.now();
    if (now - this.lastPhaseCheck < 250) return;
    this.lastPhaseCheck = now;
    const f = this.host.frame();
    if (this.phase === "surface" && this.frame) {
      // a new region was loaded under us (approaching the destination): adopt its frame
      if (f && f !== this.frame) { this.frame = f; return; }
      const dest = this.host.destination();
      if (dest && !this.landed && !this.regionPending && this.askedFor !== dest.id && rangeBearing(this.c.r, dest.r).d < 30_000) {
        this.askedFor = dest.id;
        const [lon, lat] = lonLatOf(dest.r);
        this.regionPending = true;
        void this.host.ensureRegion(lon, lat).finally(() => { this.regionPending = false; this.lastPhaseCheck = 0; });
        return;
      }
      const p = this.frame.toScene(this.c.r);
      if (p.y > 16_000 || Math.hypot(p.x, p.z) > 150_000) {
        this.phase = "orbit";
        this.host.onPhase("orbit");
        if (this.camDist < 40) this.camDist = 45;
      }
      return;
    }
    // orbit: come back down into a region when low enough
    const h = this.c.r.length() - R_MOON;
    if (f) {
      const p = f.toScene(this.c.r);
      if (p.y < 14_000 && Math.hypot(p.x, p.z) < 140_000) {
        this.frame = f;
        this.phase = "surface";
        this.host.onPhase("surface");
        return;
      }
    }
    if (h < 13_000 && !this.regionPending) {
      const dest = this.host.destination();
      let [lon, lat] = lonLatOf(this.c.r);
      if (dest && rangeBearing(this.c.r, dest.r).d < 120_000) [lon, lat] = lonLatOf(dest.r);
      this.regionPending = true;
      void this.host.ensureRegion(lon, lat).finally(() => { this.regionPending = false; this.lastPhaseCheck = 0; });
    }
  }

  private placeSurface(dt: number): void {
    const w = this.host.world;
    const f = this.frame as SceneFrame;
    const obj = w.landerObj;
    const p = f.toScene(this.c.r);
    const qS = f.quatToScene(this.c.q);
    if (obj) {
      obj.position.copy(p);
      obj.quaternion.copy(qS);
      obj.visible = !this.cockpit;
      this.animateCraft(obj);
    }
    w.player.pos.set(p.x, p.y, p.z);
    shared.sunGate.value = shared.sunGate.value; // world keeps the gate updated
    const cam = w.camera;
    if (this.cockpit) {
      cam.position.copy(new THREE.Vector3(0, 5.75, -1.2).applyQuaternion(qS).add(p));
      const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.21 + this.camPitch * 0.4 - 0.13, this.camYaw * 0.6, 0, "YXZ"));
      cam.quaternion.copy(qS).multiply(look);
    } else {
      // rigid chase camera behind the direction of motion (or the nose when hovering)
      const vS = f.dirToScene(this.c.v);
      const hs = Math.hypot(vS.x, vS.z);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(qS);
      const want = hs > 8 ? Math.atan2(vS.x, -vS.z) : Math.hypot(fwd.x, fwd.z) > 0.2 ? Math.atan2(fwd.x, -fwd.z) : this.camHeading;
      let dh = want - this.camHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.camHeading += dh * Math.min(1, dt * 2.5);
      const hd = this.camHeading + this.camYaw;
      const d = Math.min(this.camDist, 3000);
      const target = p.clone().add(new THREE.Vector3(0, 4, 0));
      const pos = target.clone().add(new THREE.Vector3(-Math.sin(hd) * Math.cos(this.camPitch) * d, Math.sin(this.camPitch) * d, Math.cos(hd) * Math.cos(this.camPitch) * d));
      const gy = w.groundAt(pos.x, pos.z) + 1.5;
      if (pos.y < gy) pos.y = gy;
      cam.position.copy(pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
    }
  }

  private animateCraft(obj: THREE.Object3D): void {
    const t = performance.now();
    for (const name of ["plume", "plumeCore"]) {
      const m = obj.getObjectByName(name) as THREE.Mesh | undefined;
      if (!m) continue;
      m.visible = this.plume > 0.02;
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.75, this.plume * (0.6 + 0.15 * Math.sin(t / 37)));
      m.scale.set(1, 0.5 + this.plume * 0.8, 1);
    }
    const nav = obj.getObjectByName("nav");
    if (nav) (nav.children[2] as THREE.Object3D).visible = Math.floor(t / 600) % 2 === 0;
  }

  private renderOrbit(r: THREE.WebGLRenderer): void {
    if (!this.view) this.view = new OrbitView();
    const v = this.view;
    const sky = this.host.sky();
    if (sky) v.setSky(sky.sun, sky.earthKm);
    if (!this.markersSet) { v.setMarkers(this.host.markers()); this.markersSet = true; }
    const d = this.host.destination();
    v.setDestination(d ? d.r : null);
    v.camYaw = this.camYaw;
    v.camPitch = this.camPitch;
    v.camDist = this.camDist / 1000;
    const exp = r.toneMappingExposure;
    r.toneMappingExposure = 1;
    shared.sunGate.value = 1;
    v.render(r, this.c, performance.now(), this.plume, r.domElement.clientWidth / Math.max(1, r.domElement.clientHeight), this.cockpit);
    r.toneMappingExposure = exp;
  }
  private markersSet = false;
  refreshMarkers(): void {
    this.markersSet = false;
  }

  // ---------- HUD ----------
  private updateHud(): void {
    const now = performance.now();
    if (now - this.hudT < 100) return;
    this.hudT = now;
    const up = this.up();
    const vUp = this.c.v.dot(up);
    const vH = Math.sqrt(Math.max(0, this.c.v.lengthSq() - vUp * vUp));
    const alt = this.c.r.length() - R_MOON;
    const agl = this.agl();
    const tilt = Math.acos(Math.max(-1, Math.min(1, bodyUp(this.c.q).dot(up)))) / D2R;
    const [lon, lat] = lonLatOf(this.c.r);
    const fmt = (m: number): string => (Math.abs(m) >= 10_000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`);
    const set = (id: string, t: string): void => { const e = $(id); if (e.textContent !== t) e.textContent = t; };
    set("fhMode", `${this.mode === "explorer" ? "EXPLORER · assisted flight" : "MANUAL · raw throttle"}${this.auto ? ` · AUTOPILOT ${this.auto === "land" ? "LAND" : "ORBIT"}${this.gPhase ? " (" + this.gPhase + ")" : ""}` : ""}`);
    set("fhPhase", `${this.landed ? "LANDED" : this.phase === "surface" ? "LOCAL FLIGHT · LOLA terrain" : "ORBIT VIEW · whole Moon"}${this.warp > 1 ? ` · TIME ×${this.warp}` : ""}`);
    set("fhAlt", fmt(this.phase === "surface" ? agl : alt));
    set("fhAltL", this.phase === "surface" ? "HEIGHT (ground)" : "ALTITUDE (mean R)");
    set("fhVs", `${vUp >= 0 ? "+" : ""}${vUp.toFixed(1)} m/s`);
    set("fhHs", `${vH.toFixed(vH < 100 ? 1 : 0)} m/s`);
    set("fhThr", `${Math.round((this.c.thrust / A_MAX) * 100)} %`);
    ($("fhThrBar") as HTMLElement).style.width = `${Math.min(100, (this.c.thrust / A_MAX) * 100)}%`;
    set("fhTgt", this.mode === "explorer" ? `climb set ${this.vzT >= 0 ? "+" : ""}${this.vzT.toFixed(0)} m/s` : `throttle ${(this.throttle * 100).toFixed(0)} %`);
    set("fhTilt", `${tilt.toFixed(0)}°`);
    set("fhDv", `${this.c.dv.toFixed(0)} m/s`);
    set("fhPos", `${Math.abs(lat).toFixed(3)}°${lat < 0 ? "S" : "N"} ${((lon + 360) % 360).toFixed(3)}°E`);
    const o = orbitOf(this.c.r, this.c.v);
    $("fhOrbit").classList.toggle("hidden", alt < 8000 && vH < 600);
    set("fhOrb", o.apoAlt === Infinity ? "escape trajectory" : o.periAlt < -R_MOON * 0.5 ? "sub-orbital (falls back)" : `Pe ${fmt(o.periAlt)} · Ap ${fmt(o.apoAlt)}${o.periAlt > 0 ? ` · ${(o.period / 60).toFixed(0)} min` : " · hits the surface"}`);
    const d = this.host.destination();
    $("fhNav").classList.toggle("hidden", !d);
    if (d) {
      const rb = rangeBearing(this.c.r, d.r);
      const qS = this.frame && this.phase === "surface" ? this.frame.quatToScene(this.c.q) : null;
      let rel = rb.brg;
      if (qS && this.frame) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(qS);
        rel = rb.brg - Math.atan2(fwd.x, -fwd.z);
      } else {
        const hd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.c.q);
        const [lo, la] = lonLatOf(this.c.r);
        const fr = new SceneFrame(lo, la, 0);
        const hs = fr.dirToScene(hd);
        rel = rb.brg - Math.atan2(hs.x, -hs.z);
      }
      set("fhDest", d.name);
      set("fhDist", rb.d < 2000 ? `${rb.d.toFixed(0)} m` : `${(rb.d / 1000).toFixed(rb.d < 100_000 ? 1 : 0)} km`);
      ($("fhArrow") as HTMLElement).style.transform = `rotate(${rel}rad)`;
    }
    $("fhExit").classList.toggle("hidden", !this.landed);
    void this.lastDist;
  }
}
