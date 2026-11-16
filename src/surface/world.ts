// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The walkable surface: Three.js scene around one site.
 * Terrain = NASA LOLA (terrain3d.ts). Sky = Horizons (sky3d.ts). Everything else
 * (outpost, rocks, astronaut, camera moves) is presentation and is labelled so.
 */

import * as THREE from "three";
import { discFractionAbove } from "../science/visibility";
import { Astronaut } from "./astronaut";
import type { GlbAstronaut } from "./character";
import { Handheld } from "./handheld";
import { Rover } from "./rover";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { regolithMaterial, shared } from "./materials";
import { buildLander, buildOutpost, label, type Interactable, type OutpostRefs } from "./outpost";
import { EYE_HEIGHT, Player } from "./player";
import { Sky3D, dirFromAzEl } from "./sky3d";
import { Interior } from "./interior";
import { buildTerrain, groundY, horizonToward, lonLatToScene, sceneToLonLat, type SurfacePatch } from "./terrain3d";
import { DPR_CAP, TERRAIN_LOD, loadGfx, saveGfx, type Gfx } from "./graphics";

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
  readonly ambient = new THREE.AmbientLight(0x8e95a6, 0.0);
  /** light bounced up from sunlit regolith (sky colour black: no atmosphere) */
  readonly bounce = new THREE.HemisphereLight(0x000000, 0x9a9282, 0.0);
  readonly lamp = new THREE.SpotLight(0xfff1dc, 0, 60, 0.55, 0.5, 1.2);
  readonly player: Player;
  astro: Astronaut | GlbAstronaut = new Astronaut();
  readonly handheld = new Handheld();
  private camVel = new THREE.Vector3();
  private camInit = false;
  patch: SurfacePatch | null = null;
  outpost: OutpostRefs | null = null;
  private terrain: THREE.Mesh[] = [];
  private props = new THREE.Group();
  private rocks: THREE.InstancedMesh[] = [];
  private skyState: SkyState | null = null;
  private gateHz = -90;
  private horizonAz = -999;
  private horizonAt = new THREE.Vector2(1e9, 1e9);
  private prompt: Interactable | null = null;
  private last = performance.now();
  private running = false;
  private raf = 0;
  private cine: { update: (t: number) => boolean; start: number; resolve: () => void } | null = null;
  realisticDark = false;
  hideHandheld = false;
  /** the kit dish model's own facing, so that it points at Earth's azimuth */
  radarOffset = Math.PI; // measured: the kit dish faces −z in its own frame
  roverGltf: GLTF | null = null;
  rover: Rover | null = null;
  private roverCollider = { x: 1e9, z: 1e9, r: 2.6 };
  private noKeys = new Set<string>();
  kitReady = false;
  headBob = true;
  lampOn = false;
  readonlyFps = { fps: 0, frames: 0, t0: performance.now() };
  private lastMoveReport = 0;
  private dragging = false;

  constructor(private host: HTMLElement, private ev: WorldEvents) {
    // No logarithmic depth buffer: it writes gl_FragDepth and so disables early-z, making
    // every hidden terrain pixel run the full shader. Depth is split into two passes instead.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = "surface-canvas";
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.08, 3200);
    this.camera.rotation.order = "YXZ";
    this.farCam = new THREE.PerspectiveCamera(62, 1, 150, 260_000);
    this.farCam.layers.set(1);
    this.sky = new Sky3D(62);

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
    this.renderer.shadowMap.autoUpdate = false; // updated once per frame, in the near pass only
    this.scene.add(this.sun, this.sun.target, this.fill, this.fill.target, this.ambient, this.bounce, this.flood);
    // lights must reach both depth passes (far terrain is on layer 1)
    for (const l of [this.sun, this.fill, this.ambient, this.bounce, this.flood, this.lamp]) l.layers.enableAll();
    this.lamp.castShadow = false;
    this.camera.add(this.lamp);
    this.lamp.position.set(0, 0.1, 0);
    this.lamp.target.position.set(0, -0.2, -1);
    this.camera.add(this.lamp.target);
    this.scene.add(this.camera);
    this.scene.add(this.props);

    this.player = new Player((x, z) => (this.patch ? groundY(this.patch, x, z) : 0));
    this.scene.add(this.astro.root);
    this.camera.add(this.handheld.group);

    window.addEventListener("resize", () => this.resize());
    this.applyGfx(this.gfx, false);
    this.resize();
    this.bindInput();
  }

  // ---------- graphics settings ----------
  gfx: Gfx = loadGfx();
  readonly farCam: THREE.PerspectiveCamera;
  /** runtime resolution factor from adaptive resolution (1 = preset value) */
  private dynScale = 1;
  readonly flood = new THREE.PointLight(0xeef0f4, 0, 50, 1.4); // base floodlight (fictional outpost lighting)

  applyGfx(g: Gfx, rebuild = true): void {
    const prev = this.gfx;
    this.gfx = g;
    saveGfx(g);
    // shadows
    const sh = g.shadows;
    this.sun.castShadow = sh !== "off";
    const size = sh === "high" ? 2048 : 1024;
    const half = sh === "high" ? 260 : 120;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: unknown }).map = null;
    }
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 6000;
    sc.updateProjectionMatrix();
    this.renderer.shadowMap.type = sh === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    for (const t of this.terrain) if (t.name === "terrain-near") t.castShadow = sh === "high";
    this.horizonAt.set(1e9, 1e9);
    this.resize();
    if (rebuild && this.patch && (prev.preset !== g.preset || prev.detail !== g.detail)) this.rebuildTerrain();
    this.applyLighting();
    this.cullTick = 0;
  }

  private detailLevel(): number {
    return this.gfx.detail === "high" ? 2 : this.gfx.detail === "medium" ? 1 : 0;
  }

  private rebuildTerrain(): void {
    if (!this.patch) return;
    for (const m of this.terrain) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const [az, ring] = TERRAIN_LOD[this.gfx.preset];
    const d = this.detailLevel();
    const { near, far } = buildTerrain(this.patch, regolithMaterial(false, d), regolithMaterial(true, d), az, ring);
    near.castShadow = this.gfx.shadows === "high";
    far.layers.set(1); // drawn in the far depth pass
    this.terrain = [near, far];
    this.scene.add(near, far);
  }

  /** Lighting mode: realistic (vacuum-black shadows) / balanced / bright (accessibility). Never changes the science. */
  applyLighting(): void {
    const mode = this.realisticDark ? "realistic" : this.gfx.lighting;
    this.renderer.toneMappingExposure = this.userExposure * (mode === "bright" ? 1.3 : mode === "balanced" ? 1.12 : 1);
    this.flood.intensity = mode === "realistic" ? 0 : mode === "bright" ? 200 : 110;
    const em = mode === "realistic" ? 0 : mode === "bright" ? 0.22 : 0.12;
    this.outpost?.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !m.userData.glow) {
        if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
        if (m.userData.baseEmissive === 0) m.emissive.copy(m.color).multiplyScalar(em);
      }
    });
    if (this.skyState) this.applySky(this.skyState);
  }
  userExposure = 1;
  sens = 1;

  /** Use the current prompt (touch: tap the prompt). */
  useCurrent(): void {
    if (this.prompt && !this.cine) this.ev.onInteract(this.prompt.id);
  }

  /** Analog stick for touch screens: x right, y forward, each in [-1, 1]. */
  setStick(x: number, y: number): void {
    const k = this.player.keys;
    for (const c of ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"]) k.delete(c);
    if (y > 0.3) k.add("KeyW");
    if (y < -0.3) k.add("KeyS");
    if (x > 0.3) k.add("KeyD");
    if (x < -0.3) k.add("KeyA");
    if (Math.hypot(x, y) > 0.92) k.add("ShiftLeft");
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
      if (document.pointerLockElement === el) look(e.movementX, e.movementY, 0.0022 * this.sens);
      else if (this.dragging) look(e.movementX, e.movementY, 0.004 * this.sens);
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
      if (e.code === "KeyL") {
        if (this.driving && this.rover) this.rover.headlights = !this.rover.headlights;
        else this.lampOn = !this.lampOn;
      }
    });
    window.addEventListener("keyup", (e) => this.player.keys.delete(e.code));
    window.addEventListener("blur", () => this.player.keys.clear());
  }

  resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, DPR_CAP[this.gfx.preset]) * this.gfx.resScale * this.dynScale;
    this.renderer.setPixelRatio(Math.max(0.5, pr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.farCam.aspect = w / h;
    this.farCam.updateProjectionMatrix();
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
    this.setWaypoint(null);
    this.rebuildTerrain();
    const gy = (x: number, z: number): number => groundY(p, x, z);
    this.outpost = null;
    const exclude: { x: number; z: number; r: number }[] = [];
    if (opts.outpost && opts.survey) {
      const [sx, sz] = lonLatToScene(p, opts.survey.lon, opts.survey.lat);
      const ss = this.skyState;
      this.outpost = buildOutpost(gy, { x: sx, z: sz }, ss?.sunAz ?? 250, Math.hypot(sx, sz), ss && ss.earthEl > -2.5 ? ss.earthAz : null, this.kitReady);
      this.props.add(this.outpost.group);
      this.player.colliders = this.outpost.colliders;
      exclude.push({ x: -8, z: 2, r: 60 }, { x: 99, z: 99, r: 26 }, { x: 30, z: -24, r: 22 }, { x: -42, z: 8, r: 9 });
      const sp = opts.spawn ?? this.outpost.spawn;
      this.player.place(sp.x, sp.z, sp.yaw);
      if (this.roverGltf) {
        if (!this.rover) this.rover = new Rover(this.roverGltf);
        this.props.add(this.rover.root);
        const b = this.outpost.roverBay;
        const toS1 = Math.atan2(sx - b.x, -(sz - b.z));
        this.rover.place(b.x, b.z, toS1, gy);
        this.player.colliders = [...this.outpost.colliders, this.roverCollider];
        exclude.push({ x: b.x, z: b.z, r: 7 });
      }
    } else {
      if (this.driving) this.exitRover();
      this.rover = null;
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
    this.indexProps();
    this.applyLighting();
    this.horizonAt.set(1e9, 1e9);
    this.warmShaders();
    if (this.skyState) this.applySky(this.skyState);
  }

  private siteInteractables: Interactable[] = [];

  // ---------- Mission Control interior ----------
  interior: Interior | null = null;
  inside = false;
  private returnSpot = { x: 0, z: 0, yaw: 0 };
  private savedColliders: { x: number; z: number; r: number }[] = [];

  enterInterior(returnSpot: { x: number; z: number; yaw: number }): void {
    this.interior ??= new Interior();
    this.returnSpot = returnSpot;
    this.inside = true;
    this.savedColliders = this.player.colliders;
    this.player.colliders = [];
    this.player.setGround(() => 0);
    this.interior.scene.add(this.astro.root);
    const e = this.interior.entry;
    this.player.place(e.x, e.z, e.yaw);
    this.prompt = null;
  }

  exitInterior(): void {
    if (!this.inside) return;
    this.inside = false;
    this.player.colliders = this.savedColliders;
    this.player.setGround((x, z) => (this.patch ? groundY(this.patch, x, z) : 0));
    this.scene.add(this.astro.root);
    const r = this.returnSpot;
    this.player.place(r.x, r.z, r.yaw);
    this.prompt = null;
  }

  /** Decorative rocks, instanced per 250 m chunk so whole chunks can be culled by distance and frustum. */
  private scatterRocks(gy: (x: number, z: number) => number, exclude: { x: number; z: number; r: number }[], density: number): void {
    const r = rng(42);
    const mat = regolithMaterial(false, 0);
    (mat as THREE.MeshStandardMaterial).color.set(0x85817a);
    const variants = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
    const counts = [520, 380, 260].map((c) => Math.round(c * density));
    const CH = 250;
    const buckets = new Map<string, THREE.Matrix4[][]>();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    variants.forEach((_, vi) => {
      const n = counts[vi] as number;
      let k = 0;
      for (let tries = 0; k < n && tries < n * 4; tries++) {
        const rad = 6 + Math.pow(r(), 0.7) * 700;
        const a = r() * Math.PI * 2;
        const x = Math.sin(a) * rad, z = -Math.cos(a) * rad;
        if (exclude.some((ex) => Math.hypot(x - ex.x, z - ex.z) < ex.r)) continue;
        const s = 0.14 + Math.pow(r(), 5) * 1.5 + (r() < 0.012 ? 1.6 : 0);
        e.set(r() * 0.4, r() * Math.PI * 2, r() * 0.4);
        q.setFromEuler(e);
        const key = `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
        if (!buckets.has(key)) buckets.set(key, [[], [], []]);
        (buckets.get(key) as THREE.Matrix4[][])[vi]!.push(new THREE.Matrix4().compose(new THREE.Vector3(x, gy(x, z) - s * 0.25, z), q.clone(), new THREE.Vector3(s, s, s)));
        k++;
      }
    });
    for (const [, lists] of buckets) {
      lists.forEach((mats, vi) => {
        if (!mats.length) return;
        const im = new THREE.InstancedMesh(variants[vi] as THREE.BufferGeometry, mat, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = true;
        im.receiveShadow = true;
        im.name = "decorative-rocks";
        this.props.add(im);
        this.rocks.push(im);
      });
    }
  }

  // ---------- distance culling (props only; terrain and science untouched) ----------
  private cullables: { o: THREE.Object3D; c: THREE.Vector3; r: number; keep: boolean }[] = [];
  private cullTick = 0;
  private indexProps(): void {
    this.cullables = [];
    const keepSet = new Set<THREE.Object3D>([...(this.outpost?.beacons.values() ?? [])]);
    const add = (o: THREE.Object3D): void => {
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      const sph = box.getBoundingSphere(new THREE.Sphere());
      this.cullables.push({ o, c: sph.center.clone(), r: sph.radius, keep: keepSet.has(o) });
    };
    for (const o of this.props.children) {
      if (o === this.outpost?.group) for (const c of o.children) { if (!(c as THREE.Sprite).isSprite) add(c); }
      else if (!(o as THREE.Sprite).isSprite && o !== this.rover?.root) add(o);
    }
  }
  private cull(): void {
    const cam = this.camera.position;
    const lim = this.gfx.renderDist;
    for (const it of this.cullables) {
      if (it.keep) continue;
      it.o.visible = it.c.distanceTo(cam) - it.r < lim;
    }
  }

  /** Compile every material up front so the first look at the astronaut or rover never stalls. */
  private warmShaders(): void {
    // Render the scene once, offscreen, from a third-person viewpoint with the suit,
    // rover and scanner visible: compiles every program and uploads textures and skin
    // data now, instead of stalling the first time the player presses V.
    const vis = this.astro.root.visible;
    this.astro.root.visible = true;
    this.handheld.group.visible = true;
    const rt = new THREE.WebGLRenderTarget(64, 64);
    const cam = this.camera.clone();
    const p = this.player.pos;
    cam.position.set(p.x - 4, p.y + 2.2, p.z + 4);
    cam.lookAt(p.x, p.y + 1, p.z);
    cam.updateMatrixWorld();
    try {
      this.renderer.setRenderTarget(rt);
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, cam);
      if (this.rover) {
        cam.position.set(this.rover.pos.x - 6, this.rover.pos.y + 3, this.rover.pos.z + 6);
        cam.lookAt(this.rover.pos);
        cam.updateMatrixWorld();
        this.renderer.render(this.scene, cam);
      }
    } catch {
      /* best effort */
    } finally {
      this.renderer.setRenderTarget(null);
      rt.dispose();
    }
    this.astro.root.visible = vis;
  }


  // ---------- sky / time ----------
  applySky(s: SkyState): void {
    this.skyState = s;
    this.sky.update(s.sunAz, s.sunEl, s.earthAz, s.earthEl, s.distKm, s.unix);
    // Earthshine fill: from Earth's direction, scaled by how much of Earth is lit.
    const lit = this.sky.earthLitFraction();
    const earthUp = s.earthEl > -1 ? 1 : 0;
    const mode = this.realisticDark ? "realistic" : this.gfx.lighting;
    this.fill.intensity = mode === "realistic" ? 0.004 * lit * earthUp : (mode === "bright" ? 0.2 : 0.1) + 0.35 * lit * earthUp;
    this.ambient.intensity = mode === "realistic" ? 0 : mode === "bright" ? 0.85 : 0.5;
    if (this.outpost) {
      for (const a of this.outpost.arrays) a.rotation.y = -s.sunAz * D2R; // panel normal (+z) → Sun azimuth
      this.outpost.dish.yaw.rotation.y = -s.earthAz * D2R;
      if (this.outpost.dish.radar) this.outpost.dish.radar.rotation.y = -s.earthAz * D2R + this.radarOffset;
      this.outpost.dish.pitch.rotation.x = Math.max(-5, s.earthEl) * D2R;
    }
    this.updateGate();
  }

  /** Fraction of the Sun's disc clearing the distant horizon at the player. */
  sunGateValue = 1;
  private updateGate(): void {
    if (!this.patch || !this.skyState) return;
    const px = this.player.pos.x, pz = this.player.pos.z;
    const az = this.skyState.sunAz;
    if (Math.hypot(px - this.horizonAt.x, pz - this.horizonAt.y) > 3 || Math.abs(az - this.horizonAz) > 0.05) {
      // terrain that the shadow map covers (high shadows: within ~260 m) is skipped here
      const minDist = this.gfx.shadows === "high" ? 300 : 12;
      this.gateHz = horizonToward(this.patch, px, pz, EYE_HEIGHT, minDist, az);
      this.horizonAt.set(px, pz);
      this.horizonAz = az;
    }
    this.sunGateValue = discFractionAbove(this.skyState.sunEl, this.gateHz, 0.2666);
    shared.sunGate.value = this.sunGateValue;
    // bounce light exists only while the ground around you is sunlit
    const up = this.skyState.sunEl > -0.3 ? 1 : 0;
    this.bounce.intensity = (this.realisticDark ? 0.25 : this.gfx.lighting === "bright" ? 1.8 : 1.4) * this.sunGateValue * up;
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
    } else if (this.driving && this.rover && this.patch) {
      const pt = this.patch;
      this.rover.update(dt, p.keys, (x, z) => groundY(pt, x, z), this.outpost?.colliders ?? [], true);
      p.pos.copy(this.rover.pos);
      p.vel.set(0, 0, 0);
      this.rover.sign.visible = false;
      this.placeRoverCamera(dt);
    } else {
      if (this.rover && this.patch) {
        const pt = this.patch;
        this.rover.update(dt, this.noKeys, (x, z) => groundY(pt, x, z), this.outpost?.colliders ?? [], false);
        const rd = this.rover.pos.distanceTo(this.camera.position);
        this.rover.sign.visible = rd > 7 && rd < 220;
        this.roverCollider.x = this.rover.pos.x;
        this.roverCollider.z = this.rover.pos.z;
      }
      p.update(dt, now);
      if (this.inside && this.interior) {
        this.interior.clamp(p.pos);
        p.pos.y = Math.max(0, p.pos.y);
      }
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
    const fpView = !p.thirdPerson && !this.cine && !this.driving;
    this.astro.setFirstPerson(fpView);
    if (this.cine) this.astro.root.visible = this.cineShowBody;
    if (this.driving) this.astro.root.visible = false;
    this.handheld.group.visible = fpView && !this.hideHandheld;
    if (fpView) this.handheld.update(dt, sp, p.stride, p.pitch);

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
    let list = this.inside && this.interior ? this.interior.interactables : [...(this.outpost?.interactables ?? []), ...this.siteInteractables];
    if (this.rover && !this.inside) {
      if (this.driving) list = Math.abs(this.rover.speed) < 0.6 ? [{ id: "rover-exit", label: "Exit rover", x: p.pos.x, z: p.pos.z, r: 1 }] : [];
      else list = [...list, { id: "rover", label: "Enter rover", x: this.rover.pos.x, z: this.rover.pos.z, r: 5 }];
    }
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
    if (this.labelTick++ % 6 === 0) {
      // labels: fixed on-screen size (sizeAttenuation off), shown between 6 m and the label range
      const range = Math.min(260, Math.max(120, this.gfx.renderDist));
      for (const l of this.outpost?.labels ?? []) {
        const d = l.position.distanceTo(this.camera.position);
        const op = d < 6 ? 0 : d < 10 ? (d - 6) / 4 : d > range ? Math.max(0, 1 - (d - range) / 60) : 1;
        (l.material as THREE.SpriteMaterial).opacity = op;
        l.visible = op > 0.01;
      }
    }
    if (this.waypoint) {
      const ring = this.waypoint.getObjectByName("ring") as THREE.Mesh;
      const k = 1 + 0.15 * Math.sin(now / 300);
      ring.scale.set(k, k, k);
    }
    const beam = this.outpost?.beacons.get("survey")?.getObjectByName("beam");
    if (beam) {
      const b = beam as THREE.Mesh;
      const bp = this.outpost?.beacons.get("survey")?.position;
      b.visible = this.beamOn && (!bp || Math.hypot(bp.x - p.pos.x, bp.z - p.pos.z) > 25);
    }

    this.sky.syncCamera(this.camera);
    this.afterFrame?.();
    const r = this.renderer;
    if (this.paused) return;
    if (++this.cullTick % 15 === 1) this.cull();
    this.flood.position.set(-3, (this.outpost ? this.groundAt(-3, 2) : 0) + 9, 2);
    this.adaptRes(dt);
    if (this.inside && this.interior) {
      this.interior.tick(now);
      this.camera.updateMatrixWorld(); // the camera lives in the outdoor scene, which is not rendered here
      r.clear();
      r.render(this.interior.scene, this.camera);
      return;
    }
    r.clear();
    r.render(this.sky.scene, this.sky.camera);
    // far terrain (2–220 km) with its own depth range, then everything near with a tight one
    r.clearDepth();
    this.farCam.position.copy(this.camera.position);
    this.farCam.quaternion.copy(this.camera.quaternion);
    this.farCam.fov = this.camera.fov;
    this.farCam.updateMatrixWorld();
    r.render(this.scene, this.farCam);
    r.clearDepth();
    r.shadowMap.needsUpdate = this.sun.castShadow;
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.sky.overlay, this.sky.camera);
  }

  beamOn = true;
  cineShowBody = true;
  paused = false;
  private labelTick = 0;
  /** smoothed frame time (ms) for the fps counter and adaptive resolution */
  frameMs = 16;
  private slowFor = 0;
  private fastFor = 0;

  /** Adaptive resolution: if frames stay slow (< ~36 fps) drop the render scale a notch; recover when fast. */
  private adaptRes(dt: number): void {
    const ms = dt * 1000;
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (!this.gfx.adaptive) return;
    if (this.frameMs > 28) { this.slowFor += dt; this.fastFor = 0; } else if (this.frameMs < 18) { this.fastFor += dt; this.slowFor = 0; } else { this.slowFor = 0; this.fastFor = 0; }
    if (this.slowFor > 2 && this.dynScale > 0.6) { this.dynScale = Math.max(0.6, this.dynScale - 0.1); this.slowFor = 0; this.resize(); }
    if (this.fastFor > 5 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.1); this.fastFor = 0; this.resize(); }
  }
  get renderScale(): number {
    return this.renderer.getPixelRatio();
  }
  afterFrame: (() => void) | null = null;

  /** Screen position (CSS px) of a sky direction; z > 1 means behind the camera. */
  projectDir(dir: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const v = dir.clone().multiplyScalar(1000).applyQuaternion(this.camera.quaternion.clone().invert());
    const behind = v.z > 0;
    const p = dir.clone().multiplyScalar(1000).project(this.sky.camera);
    const el = this.renderer.domElement;
    return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight, behind };
  }
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

  private lastCam = 0;
  driving = false;

  private placeCamera(now: number): void {
    const p = this.player;
    const c = this.camera;
    if (!p.thirdPerson) {
      let bob = 0;
      if (this.headBob && p.onGround) bob = Math.sin(p.stride * 2.2) * 0.025 * Math.min(1, p.horizontalSpeed / 1.6);
      const landing = Math.max(0, 1 - (now - p.landedAt) / 260) * 0.06;
      // eye sits inside the helmet, slightly forward of the body's centre line
      const fx = Math.sin(p.yaw) * 0.06, fz = -Math.cos(p.yaw) * 0.06;
      c.position.set(p.pos.x + fx, p.pos.y + EYE_HEIGHT + bob - landing, p.pos.z + fz);
      c.rotation.set(p.pitch, -p.yaw, 0);
    } else if (this.inside) {
      // a corner camera, like the module's own monitoring camera
      c.position.set(p.pos.x * 0.4 + (p.pos.x >= 0 ? -1.5 : 1.5), 2.7, 2.95);
      c.lookAt(p.pos.x, 1.1, p.pos.z - 0.6);
    } else {
      // over-the-shoulder: behind and slightly right of the suit, smoothed, kept above ground
      const dist = 4.2, side = 0.75;
      const sy = Math.sin(p.yaw), cyw = Math.cos(p.yaw);
      const pitch = Math.max(-0.9, Math.min(0.6, p.pitch));
      const want = new THREE.Vector3(
        p.pos.x - sy * dist * Math.cos(pitch) + cyw * side,
        p.pos.y + 1.9 - Math.sin(pitch) * dist,
        p.pos.z + cyw * dist * Math.cos(pitch) + sy * side,
      );
      if (this.patch) want.y = Math.max(want.y, groundY(this.patch, want.x, want.z) + 0.5);
      // keep the camera out of buildings: pull it in toward the suit if it would sit inside a structure
      for (const col of this.player.colliders) {
        if (col.r < 1.5) continue;
        const dx = want.x - col.x, dz = want.z - col.z;
        if (Math.hypot(dx, dz) < col.r + 0.6) {
          const t = 0.35;
          want.x = p.pos.x + (want.x - p.pos.x) * t;
          want.z = p.pos.z + (want.z - p.pos.z) * t;
          want.y = Math.max(want.y, p.pos.y + 2.2);
          break;
        }
      }
      if (!this.camInit) { c.position.copy(want); this.camInit = true; }
      const k = 1 - Math.exp(-12 * Math.min(0.05, (now - this.lastCam) / 1000 || 0.016));
      c.position.lerp(want, k);
      const look = new THREE.Vector3(p.pos.x + sy * 8 * Math.cos(pitch) + cyw * side, p.pos.y + 1.55 + Math.sin(pitch) * 8, p.pos.z - cyw * 8 * Math.cos(pitch) + sy * side);
      c.lookAt(look);
    }
    this.lastCam = now;
  }

  enterRover(): void {
    if (!this.rover || this.driving) return;
    this.driving = true;
    this.camInit = false;
    this.rover.speed = 0;
    this.prompt = null;
  }

  exitRover(): void {
    if (!this.rover || !this.driving) return;
    this.driving = false;
    const e = this.rover.exitSpot();
    this.player.place(e.x, e.z, e.yaw);
    this.camInit = false;
    this.prompt = null;
  }

  private placeRoverCamera(dt: number): void {
    const r = this.rover as Rover;
    const c = this.camera;
    const fx = Math.sin(r.yaw), fz = -Math.cos(r.yaw);
    const want = new THREE.Vector3(r.pos.x - fx * 10, r.pos.y + 4.4, r.pos.z - fz * 10);
    if (this.patch) want.y = Math.max(want.y, groundY(this.patch, want.x, want.z) + 1.2);
    if (!this.camInit) { c.position.copy(want); this.camInit = true; }
    c.position.lerp(want, 1 - Math.exp(-6 * dt));
    c.lookAt(r.pos.x + fx * 8, r.pos.y + 1.6, r.pos.z + fz * 8);
  }

  /** Swap in the rigged GLB astronaut once it has loaded. */
  setCharacter(c: GlbAstronaut): void {
    const parent = this.astro.root.parent;
    parent?.remove(this.astro.root);
    this.astro = c;
    (parent ?? this.scene).add(c.root);
  }

  toggleView(): boolean {
    this.camInit = false;
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
