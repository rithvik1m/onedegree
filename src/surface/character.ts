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
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const name = clip.name.split("|").pop() as string;
      this.actions.set(name, this.mixer.clipAction(clip));
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
    if (performance.now() < this.interactUntil && speed < 0.3) this.play("Interact", 0.2);
    else if (gait === "air") this.play("Idle_Neutral", 0.3);
    else if (gait === "lope") this.play("Run", 0.25, Math.max(0.6, speed / 5.5));
    else if (gait === "walk") this.play("Walk", 0.25, Math.max(0.6, speed / 2.2));
    else this.play("Idle", 0.35);
    if (this.current && this.currentName !== "Interact") this.current.timeScale = gait === "lope" ? Math.max(0.6, speed / 5.5) : gait === "walk" ? Math.max(0.6, speed / 2.2) : 1;
    this.mixer.update(dt);
  }
}
