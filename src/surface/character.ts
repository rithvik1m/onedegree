// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The player's astronaut: Quaternius "Astronaut" (CC0, rigged, animated), recoloured
 * to a white EVA suit. Animations: Idle, Walk, Run (used for the faster lunar lope),
 * Interact (using an instrument). In the air we hold a relaxed idle. Same interface as
 * the old procedural suit so the world code does not care which one it gets.
 */

import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Gait } from "./astronaut";

const SUIT_COLORS: Record<string, number> = {
  SciFi_Main: 0xe6e3dc, // was dark teal → white suit fabric
  SciFi_MainDark: 0x9a9da3, // joints / under-suit → mid grey
  SciFi_Light: 0xf2f0ea, // armour plates → bright white
  SciFi_Light_Accent: 0xd8642e, // orange accents kept (high-visibility trim)
  Grey: 0x1d1f24, // visor / gloves → dark
};

export class GlbAstronaut {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = "";
  private interactUntil = 0;
  private model: THREE.Object3D;
  private baseY = 0;
  private wasAir = false;
  private landT = 0;

  constructor(gltf: GLTF, height = 1.85) {
    const model = gltf.scene;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds are bind-pose only
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        const c = SUIT_COLORS[mat.name];
        if (c !== undefined) mat.color.set(c);
        mat.roughness = mat.name === "Grey" ? 0.25 : 0.7;
        mat.metalness = mat.name === "Grey" ? 0.6 : 0.05;
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y || 1;
    const k = height / h;
    model.scale.multiplyScalar(k);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y; // feet on y = 0
    model.rotation.y = Math.PI; // glTF faces +z; our forward is −z
    this.root.add(model);
    this.model = model;
    this.baseY = model.position.y;
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const name = clip.name.split("|").pop() as string;
      this.actions.set(name, this.mixer.clipAction(clip));
    }
    // airborne pose: the run cycle frozen at full extension (a lunar bound), as its own action
    const run = gltf.animations.find((c) => c.name.endsWith("Run"));
    if (run) {
      const air = run.clone();
      air.name = "Air";
      const a = this.mixer.clipAction(air);
      a.time = air.duration * 0.28;
      a.timeScale = 0;
      this.actions.set("Air", a);
    }
    this.play("Idle", 0);
  }

  private play(name: string, fade = 0.25, timeScale = 1): void {
    const a = this.actions.get(name) ?? this.actions.get("Idle");
    if (!a) return;
    a.timeScale = timeScale;
    if (this.currentName === name) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
    this.currentName = name;
  }

  /** Briefly play the "Interact" gesture (using an instrument). */
  gesture(): void {
    this.interactUntil = performance.now() + 1400;
    const a = this.actions.get("Interact");
    if (a) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
  }

  setFirstPerson(fp: boolean): void {
    this.root.visible = !fp;
  }

  animate(dt: number, speed: number, gait: Gait, _vy: number): void {
    const air = gait === "air";
    if (this.wasAir && !air) this.landT = 0.32; // touchdown
    this.wasAir = air;
    if (performance.now() < this.interactUntil && speed < 0.3) this.play("Interact", 0.2);
    else if (air) {
      const a = this.actions.get("Air");
      if (a && this.currentName !== "Air") {
        a.reset();
        a.time = a.getClip().duration * 0.28;
        a.timeScale = 0;
        a.setEffectiveWeight(1).fadeIn(0.18).play();
        this.current?.fadeOut(0.18);
        this.current = a;
        this.currentName = "Air";
      }
    } else if (gait === "lope") this.play("Run", 0.22, Math.max(0.6, speed / 7));
    else if (gait === "walk") this.play("Walk", 0.25, Math.max(0.6, speed / 2.4));
    else this.play("Idle", 0.35);
    if (this.current && this.currentName !== "Interact" && this.currentName !== "Air") this.current.timeScale = gait === "lope" ? Math.max(0.6, speed / 7) : gait === "walk" ? Math.max(0.6, speed / 2.4) : 1;
    this.mixer.update(dt);
    // low-gravity bounding when sprinting (two bounds per run cycle) and a short knee dip on landing
    let off = 0;
    if (gait === "lope" && this.current) off += Math.abs(Math.sin((this.current.time / this.current.getClip().duration) * Math.PI * 2)) * 0.09;
    if (this.landT > 0) {
      this.landT = Math.max(0, this.landT - dt);
      off -= Math.sin((1 - this.landT / 0.32) * Math.PI) * 0.12;
    }
    this.model.position.y = this.baseY + off;
  }
}
