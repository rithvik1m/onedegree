// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The walkable surface: Three.js scene around one site.
 * Terrain = NASA LOLA (terrain3d.ts). Sky = Horizons (sky3d.ts). Everything else
 * (outpost, rocks, astronaut, camera moves) is presentation and is labelled so.
 */

import * as THREE from "three";
import { discFractionAbove } from "../science/visibility";
import { Astronaut } from "./astronaut";
import { regolithMaterial, shared } from "./materials";
import { buildLander, buildOutpost, label, type Interactable, type OutpostRefs } from "./outpost";
import { EYE_HEIGHT, Player } from "./player";
import { Sky3D, dirFromAzEl } from "./sky3d";
import { buildTerrain, farHorizon, groundY, lonLatToScene, sceneToLonLat, type SurfacePatch } from "./terrain3d";

const D2R = Math.PI / 180;

export interface SkyState { sunAz: number; sunEl: number; earthAz: number; earthEl: number; distKm: number; unix: number }

export interface WorldEvents {
  onPrompt: (text: string | null) => void;
  onInteract: (id: string) => void;
  onMove: (lon: number, lat: number, x: number, z: number) => void;
  onPointerLock: (locked: boolean) => void;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const r = rng(seed);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const off: number[] = [];
  for (let i = 0; i < 6; i++) off.push(r() * 10);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(x * 3.1 + (off[0] as number)) * Math.cos(z * 2.7 + (off[1] as number)) + 0.12 * Math.sin(y * 5.3 + (off[2] as number));
    p.setXYZ(i, x * n * (1 + (off[3] as number) * 0.03), y * n * 0.62, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export class SurfaceWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sky: Sky3D;
  readonly sun = new THREE.DirectionalLight(0xfff4e6, 3.4);
  readonly fill = new THREE.DirectionalLight(0xa9c1ff, 0.0);
  readonly ambient = new THREE.AmbientLight(0x8090a8, 0.0);
  /** light bounced up from sunlit regolith (sky colour black: no atmosphere) */
  readonly bounce = new THREE.HemisphereLight(0x000000, 0x9a9282, 0.0);
  readonly lamp = new THREE.SpotLight(0xfff1dc, 0, 60, 0.55, 0.5, 1.2);
  readonly player: Player;
  readonly astro = new Astronaut();
  patch: SurfacePatch | null = null;
  outpost: OutpostRefs | null = null;
  private terrain: THREE.Mesh[] = [];
  private props = new THREE.Group();
  private rocks: THREE.InstancedMesh[] = [];
  private skyState: SkyState | null = null;
  private horizonHere = new Float32Array(360);
  private horizonAt = new THREE.Vector2(1e9, 1e9);
  private prompt: Interactable | null = null;
  private last = performance.now();
  private running = false;
  private raf = 0;
  private cine: { update: (t: number) => boolean; start: number; resolve: () => void } | null = null;
  realisticDark = false;
  headBob = true;
  lampOn = false;
  readonlyFps = { fps: 0, frames: 0, t0: performance.now() };
  private lastMoveReport = 0;
  private dragging = false;

  constructor(private host: HTMLElement, private ev: WorldEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = "surface-canvas";
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 400_000);
    this.camera.rotation.order = "YXZ";
    this.sky = new Sky3D(62);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -380; sc.right = 380; sc.top = 380; sc.bottom = -380; sc.near = 1; sc.far = 6000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
    this.scene.add(this.sun, this.sun.target, this.fill, this.fill.target, this.ambient, this.bounce);
    this.lamp.castShadow = false;
    this.camera.add(this.lamp);
    this.lamp.position.set(0, 0.1, 0);
    this.lamp.target.position.set(0, -0.2, -1);
    this.camera.add(this.lamp.target);
    this.scene.add(this.camera);
    this.scene.add(this.props);

    this.player = new Player((x, z) => (this.patch ? groundY(this.patch, x, z) : 0));
    this.scene.add(this.astro.root);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.bindInput();
  }

  // ---------- input ----------
  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener("click", () => {
      if (!this.cine && document.pointerLockElement !== el && matchMedia("(pointer: fine)").matches) void el.requestPointerLock?.();
    });
    document.addEventListener("pointerlockchange", () => this.ev.onPointerLock(document.pointerLockElement === el));
    const look = (dx: number, dy: number, k: number): void => {
      this.player.yaw += dx * k;
      this.player.pitch = Math.max(-1.45, Math.min(1.35, this.player.pitch - dy * k));
    };
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === el) look(e.movementX, e.movementY, 0.0022);
      else if (this.dragging) look(e.movementX, e.movementY, 0.004);
    });
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") this.dragging = true;
      else if (document.pointerLockElement !== el && !matchMedia("(pointer: fine)").matches) this.dragging = true;
    });
    window.addEventListener("pointerup", () => (this.dragging = false));
    let tx = 0, ty = 0;
    el.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) { tx = t.clientX; ty = t.clientY; } }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      if (!t) return;
      look(t.clientX - tx, t.clientY - ty, 0.005);
      tx = t.clientX; ty = t.clientY;
    }, { passive: true });
    window.addEventListener("keydown", (e) => {
      if (!this.running || (e.target as HTMLElement)?.closest?.("input, select, textarea, dialog")) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "KeyQ"].includes(e.code)) {
        this.player.keys.add(e.code);
        if (e.code.startsWith("Arrow")) e.preventDefault();
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (this.cine) this.skipCinematic();
        else this.player.jump();
      }
      if (e.code === "KeyE" && this.prompt && !this.cine) this.ev.onInteract(this.prompt.id);
      if (e.code === "KeyL") this.lampOn = !this.lampOn;
    });
    window.addEventListener("keyup", (e) => this.player.keys.delete(e.code));
    window.addEventListener("blur", () => this.player.keys.clear());
  }

  resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- site ----------
  setSite(p: SurfacePatch, opts: { outpost?: boolean; survey?: { lon: number; lat: number }; spawn?: { x: number; z: number; yaw: number } } = {}): void {
    for (const m of this.terrain) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.terrain = [];
    this.scene.remove(this.props);
    this.props = new THREE.Group();
    this.scene.add(this.props);
    for (const r of this.rocks) r.dispose();
    this.rocks = [];
    this.patch = p;
    const { near, far } = buildTerrain(p, regolithMaterial(false), regolithMaterial(true));
    this.terrain = [near, far];
    this.scene.add(near, far);
    const gy = (x: number, z: number): number => groundY(p, x, z);
    this.outpost = null;
    const exclude: { x: number; z: number; r: number }[] = [];
    if (opts.outpost && opts.survey) {
      const [sx, sz] = lonLatToScene(p, opts.survey.lon, opts.survey.lat);
      this.outpost = buildOutpost(gy, { x: sx, z: sz }, this.skyState?.sunAz ?? 250, Math.hypot(sx, sz));
      this.props.add(this.outpost.group);
      this.player.colliders = this.outpost.colliders;
      exclude.push({ x: -8, z: 2, r: 60 }, { x: 99, z: 99, r: 26 }, { x: 30, z: -24, r: 22 }, { x: -42, z: 8, r: 9 });
      const sp = opts.spawn ?? this.outpost.spawn;
      this.player.place(sp.x, sp.z, sp.yaw);
    } else {
      // your lander, parked 25 m north-east of where you stand
      const lander = buildLander();
      const lx = 18, lz = -18;
      lander.position.set(lx, gy(lx, lz) + 0.1, lz);
      this.props.add(lander);
      const l = label("LANDER · OD-1", "board to return to orbit", 1);
      l.position.set(lx, gy(lx, lz) + 11, lz);
      this.props.add(l);
      this.player.colliders = [{ x: lx, z: lz, r: 3.6 }];
      this.siteInteractables = [{ id: "lander", label: "Board spacecraft · launch to orbit", x: lx - 4.6, z: lz - 1, r: 3 }];
      exclude.push({ x: lx, z: lz, r: 8 }, { x: 0, z: 0, r: 4 });
      const sp = opts.spawn ?? { x: 0, z: 0, yaw: Math.atan2(lx, -lz) + 0.5 };
      this.player.place(sp.x, sp.z, sp.yaw);
    }
    this.scatterRocks(gy, exclude, p.kind === "smooth" ? 0.5 : 1);
    this.horizonAt.set(1e9, 1e9);
    if (this.skyState) this.applySky(this.skyState);
  }

  private siteInteractables: Interactable[] = [];

  private scatterRocks(gy: (x: number, z: number) => number, exclude: { x: number; z: number; r: number }[], density: number): void {
    const r = rng(42);
    const mat = regolithMaterial(false);
    (mat as THREE.MeshStandardMaterial).color.set(0x85817a);
    const variants = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
    const counts = [900, 700, 500].map((c) => Math.round(c * density));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    variants.forEach((geo, vi) => {
      const n = counts[vi] as number;
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.castShadow = true;
      im.receiveShadow = true;
      let k = 0;
      for (let tries = 0; k < n && tries < n * 4; tries++) {
        const rad = 6 + Math.pow(r(), 0.7) * 700;
        const a = r() * Math.PI * 2;
        const x = Math.sin(a) * rad, z = -Math.cos(a) * rad;
        if (exclude.some((ex) => Math.hypot(x - ex.x, z - ex.z) < ex.r)) continue;
        // size distribution: many pebbles, few boulders (power law)
        const s = 0.08 + Math.pow(r(), 6) * 1.6 + (r() < 0.01 ? 1.5 : 0);
        e.set(r() * 0.4, r() * Math.PI * 2, r() * 0.4);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x, gy(x, z) - s * 0.25, z), q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(k++, m4);
      }
      im.count = k;
      im.instanceMatrix.needsUpdate = true;
      im.name = "decorative-rocks";
      this.props.add(im);
      this.rocks.push(im);
    });
  }

  // ---------- sky / time ----------
  applySky(s: SkyState): void {
    this.skyState = s;
    this.sky.update(s.sunAz, s.sunEl, s.earthAz, s.earthEl, s.distKm, s.unix);
    // Earthshine fill: from Earth's direction, scaled by how much of Earth is lit.
    const lit = this.sky.earthLitFraction();
    const earthUp = s.earthEl > -1 ? 1 : 0;
    this.fill.intensity = this.realisticDark ? 0.004 * lit * earthUp : (0.08 + 0.35 * lit * earthUp);
    this.ambient.intensity = this.realisticDark ? 0.0 : 0.16;
    if (this.outpost) {
      for (const a of this.outpost.arrays) a.rotation.y = -s.sunAz * D2R; // panel normal (+z) → Sun azimuth
      this.outpost.dish.yaw.rotation.y = -s.earthAz * D2R;
      this.outpost.dish.pitch.rotation.x = Math.max(-5, s.earthEl) * D2R;
    }
    this.updateGate();
  }

  /** Fraction of the Sun's disc clearing the distant horizon at the player. */
  sunGateValue = 1;
  private updateGate(): void {
    if (!this.patch || !this.skyState) return;
    const px = this.player.pos.x, pz = this.player.pos.z;
    if (Math.hypot(px - this.horizonAt.x, pz - this.horizonAt.y) > 15) {
      farHorizon(this.patch, px, pz, EYE_HEIGHT, 350, this.horizonHere);
      this.horizonAt.set(px, pz);
    }
    const n = this.horizonHere.length;
    const f = (((this.skyState.sunAz % 360) + 360) % 360) / (360 / n);
    const i = Math.floor(f) % n, t = f - Math.floor(f);
    const hz = (this.horizonHere[i] as number) * (1 - t) + (this.horizonHere[(i + 1) % n] as number) * t;
    this.sunGateValue = discFractionAbove(this.skyState.sunEl, hz, 0.2666);
    shared.sunGate.value = this.sunGateValue;
    // bounce light exists only while the ground around you is sunlit
    const up = this.skyState.sunEl > -0.3 ? 1 : 0;
    this.bounce.intensity = (this.realisticDark ? 0.25 : 1.1) * this.sunGateValue * up;
  }

  // ---------- loop ----------
  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.domElement.style.display = "block";
    this.last = performance.now();
    const loop = (): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.player.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const fp = this.readonlyFps;
    fp.frames++;
    if (now - fp.t0 > 1000) { fp.fps = (fp.frames * 1000) / (now - fp.t0); fp.frames = 0; fp.t0 = now; }

    const p = this.player;
    if (this.cine) {
      const done = this.cine.update(now - this.cine.start);
      if (done) { const r = this.cine.resolve; this.cine = null; r(); }
    } else {
      p.update(dt, now);
      this.placeCamera(now);
    }
    // body
    this.astro.root.position.copy(p.pos);
    const sp = p.horizontalSpeed;
    if (!p.thirdPerson || sp < 0.2) this.astro.root.rotation.y = -p.yaw;
    if (p.thirdPerson && sp > 0.2) {
      const target = Math.atan2(-p.vel.x, -p.vel.z);
      let d = target - this.astro.root.rotation.y;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.astro.root.rotation.y += d * Math.min(1, dt * 8);
    }
    this.astro.animate(dt, sp, !p.onGround ? "air" : sp > 2.6 ? "lope" : sp > 0.25 ? "walk" : "idle", p.vel.y);
    this.astro.setFirstPerson(!p.thirdPerson && !this.cine);
    this.astro.root.visible = this.cine ? this.cineShowBody : true;

    // sun / shadows follow the player
    const sd = this.sky.sunDir;
    this.sun.position.copy(p.pos).addScaledVector(sd, 3000);
    this.sun.target.position.copy(p.pos);
    this.sun.intensity = sd.y > -0.02 ? 3.4 : 0;
    this.fill.position.copy(p.pos).addScaledVector(this.sky.earthDir, 1000);
    this.fill.target.position.copy(p.pos);
    this.lamp.intensity = this.lampOn ? 40 : 0;
    shared.player.value.copy(p.pos);
    if (now - this.lastMoveReport > 400) {
      this.lastMoveReport = now;
      this.updateGate();
      if (this.patch) {
        const [lon, lat] = sceneToLonLat(this.patch, p.pos.x, p.pos.z);
        this.ev.onMove(lon, lat, p.pos.x, p.pos.z);
      }
    }
    // interaction prompt
    const list = [...(this.outpost?.interactables ?? []), ...this.siteInteractables];
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const it of list) {
      const d = Math.hypot(p.pos.x - it.x, p.pos.z - it.z);
      if (d < it.r && d < bd) { best = it; bd = d; }
    }
    if (this.cine) best = null;
    if (best !== this.prompt) {
      this.prompt = best;
      this.ev.onPrompt(best ? best.label : null);
    }
    // labels: fade with distance
    for (const l of this.outpost?.labels ?? []) {
      const d = l.position.distanceTo(this.camera.position);
      (l.material as THREE.SpriteMaterial).opacity = d < 4 ? 0 : d > 160 ? Math.max(0, 1 - (d - 160) / 140) : 1;
      const s = Math.max(1, d / 40);
      l.scale.set(4 * s * (l.userData.k ?? 1), 1 * s * (l.userData.k ?? 1), 1);
    }
    if (this.waypoint) {
      const ring = this.waypoint.getObjectByName("ring") as THREE.Mesh;
      const k = 1 + 0.15 * Math.sin(now / 300);
      ring.scale.set(k, k, k);
    }
    const beam = this.outpost?.beacons.get("survey")?.getObjectByName("beam");
    if (beam) (beam as THREE.Mesh).visible = this.beamOn;

    this.sky.syncCamera(this.camera);
    const r = this.renderer;
    r.clear();
    r.render(this.sky.scene, this.sky.camera);
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.sky.overlay, this.sky.camera);
  }

  beamOn = true;
  cineShowBody = true;
  private waypoint: THREE.Group | null = null;

  /** Objective marker: a pulsing ring and a faint light column (UI, not scenery). */
  setWaypoint(p: { x: number; z: number } | null): void {
    if (this.waypoint) {
      this.scene.remove(this.waypoint);
      this.waypoint = null;
    }
    if (!p || !this.patch) return;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 48), new THREE.MeshBasicMaterial({ color: 0xf2b544, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.name = "ring";
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xf2b544, transparent: true, opacity: 0.18, depthWrite: false }));
    col.position.y = 20;
    g.add(ring, col);
    g.position.set(p.x, this.groundAt(p.x, p.z), p.z);
    this.waypoint = g;
    this.scene.add(g);
  }

  private placeCamera(now: number): void {
    const p = this.player;
    const c = this.camera;
    if (!p.thirdPerson) {
      let bob = 0;
      if (this.headBob && p.onGround) bob = Math.sin(p.stride * 2.2) * 0.025 * Math.min(1, p.horizontalSpeed / 1.6);
      const landing = Math.max(0, 1 - (now - p.landedAt) / 260) * 0.06;
      // eye sits inside the helmet, slightly forward of the body's centre line
      const fx = Math.sin(p.yaw) * 0.12, fz = -Math.cos(p.yaw) * 0.12;
      c.position.set(p.pos.x + fx, p.pos.y + EYE_HEIGHT + bob - landing, p.pos.z + fz);
      c.rotation.set(p.pitch, -p.yaw, 0);
    } else {
      const dist = 5.2;
      const back = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch * 0.6), 0, Math.cos(p.yaw) * Math.cos(p.pitch * 0.6));
      const cx = p.pos.x + back.x * dist, cz = p.pos.z + back.z * dist;
      let cy = p.pos.y + 2.2 - Math.sin(p.pitch) * 3;
      if (this.patch) cy = Math.max(cy, groundY(this.patch, cx, cz) + 0.6);
      c.position.set(cx, cy, cz);
      c.lookAt(p.pos.x, p.pos.y + 1.4, p.pos.z);
    }
  }

  toggleView(): boolean {
    this.player.thirdPerson = !this.player.thirdPerson;
    return this.player.thirdPerson;
  }

  // ---------- cinematics ----------
  cinematic(durationMs: number, f: (u: number, cam: THREE.PerspectiveCamera) => void, showBody = true): Promise<void> {
    if (this.cine) this.skipCinematic();
    this.cineShowBody = showBody;
    if (document.pointerLockElement) document.exitPointerLock();
    return new Promise((resolve) => {
      this.cine = {
        start: performance.now(),
        resolve,
        update: (t) => {
          const u = Math.min(1, t / durationMs);
          f(u, this.camera);
          return u >= 1;
        },
      };
    });
  }

  skipCinematic(): void {
    if (!this.cine) return;
    this.cine.update(1e12);
    const r = this.cine.resolve;
    this.cine = null;
    r();
  }

  get inCinematic(): boolean {
    return !!this.cine;
  }

  /** Point the camera at (az, el) from a position. */
  static lookAzEl(cam: THREE.PerspectiveCamera, az: number, el: number): void {
    const d = dirFromAzEl(az, el);
    cam.lookAt(cam.position.x + d.x, cam.position.y + d.y, cam.position.z + d.z);
  }

  sceneOf(lon: number, lat: number): [number, number] {
    return this.patch ? lonLatToScene(this.patch, lon, lat) : [0, 0];
  }

  groundAt(x: number, z: number): number {
    return this.patch ? groundY(this.patch, x, z) : 0;
  }
}
