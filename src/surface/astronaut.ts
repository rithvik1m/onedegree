// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * An original, procedurally built and procedurally animated EVA suit (no external
 * asset). Jointed limbs let it walk, lope, jump and idle without a rig.
 * Gaits are artistic, loosely modelled on Apollo EVA footage (the "bunny hop"
 * lope at speed); the physics that moves the body lives in player.ts.
 */

import * as THREE from "three";
import { gated } from "./materials";

export type Gait = "idle" | "walk" | "lope" | "air";

function mat(color: number, rough = 0.8, metal = 0): THREE.MeshStandardMaterial {
  return gated(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
}

const SUIT = mat(0xe9e6df, 0.82);
const SUIT_SHADE = mat(0xc9c5bc, 0.85);
const GREY = mat(0x6d7178, 0.6, 0.3);
const DARK = mat(0x2a2c30, 0.7, 0.2);
const VISOR = gated(new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.12, metalness: 1 }));
const ACCENT = mat(0xd2553f, 0.6);

function cap(r: number, len: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  g.translate(0, -len / 2 - r * 0.2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function box(w: number, h: number, d: number, m: THREE.Material, r = 0.03): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  // soften corners
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x - Math.sign(x) * r * (Math.abs(y) > h / 2 - 1e-6 && Math.abs(z) > d / 2 - 1e-6 ? 1 : 0), y, z);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

interface Limb { root: THREE.Group; mid: THREE.Group }

export class Astronaut {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso = new THREE.Group();
  readonly head = new THREE.Group();
  private armL: Limb;
  private armR: Limb;
  private legL: Limb;
  private legR: Limb;
  private phase = 0;
  private bob = 0;
  private crouch = 0;
  /** parts hidden in first person (they would sit inside the camera) */
  private fpHidden: THREE.Object3D[] = [];

  constructor() {
    this.root.add(this.body);
    this.body.position.y = 0;
    // pelvis / hips
    const hips = box(0.38, 0.2, 0.26, SUIT_SHADE);
    hips.position.y = 0.98;
    this.body.add(hips);
    this.fpHidden.push(hips);
    this.torso.position.y = 1.06;
    this.body.add(this.torso);
    const chest = box(0.5, 0.5, 0.32, SUIT);
    chest.position.y = 0.27;
    this.torso.add(chest);
    const dcm = box(0.26, 0.14, 0.08, GREY); // chest display & control module
    dcm.position.set(0, 0.3, -0.19);
    this.torso.add(dcm);
    const stripe = box(0.06, 0.4, 0.01, ACCENT);
    stripe.position.set(0.19, 0.3, -0.163);
    this.torso.add(stripe);
    const plss = box(0.48, 0.62, 0.24, SUIT_SHADE); // life-support backpack
    plss.position.set(0, 0.3, 0.27);
    this.torso.add(plss);
    const plssTop = box(0.4, 0.06, 0.2, GREY);
    plssTop.position.set(0, 0.63, 0.27);
    this.torso.add(plssTop);
    // helmet
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.06, 20), GREY);
    neck.position.y = 0.0;
    this.head.add(neck);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 20), SUIT);
    shell.position.y = 0.14;
    shell.castShadow = true;
    this.head.add(shell);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 28, 20, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.26, Math.PI * 0.42), VISOR);
    visor.position.y = 0.14;
    this.head.add(visor);
    const lampL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), DARK);
    lampL.position.set(-0.13, 0.27, -0.06);
    const lampR = lampL.clone();
    lampR.position.x = 0.13;
    this.head.add(lampL, lampR);
    this.fpHidden.push(this.head, plssTop, chest, dcm, stripe, plss);

    const arm = (side: number): Limb => {
      const root = new THREE.Group();
      root.position.set(side * 0.31, 0.47, 0);
      this.torso.add(root);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), SUIT);
      shoulder.castShadow = true;
      root.add(shoulder);
      root.add(cap(0.075, 0.24, SUIT));
      const mid = new THREE.Group();
      mid.position.y = -0.33;
      root.add(mid);
      mid.add(cap(0.068, 0.22, SUIT));
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14), GREY);
      cuff.position.y = -0.3;
      mid.add(cuff);
      const glove = box(0.09, 0.13, 0.07, DARK, 0.02);
      glove.position.y = -0.39;
      mid.add(glove);
      return { root, mid };
    };
    const leg = (side: number): Limb => {
      const root = new THREE.Group();
      root.position.set(side * 0.12, 0.96, 0);
      this.body.add(root);
      root.add(cap(0.095, 0.34, SUIT));
      const mid = new THREE.Group();
      mid.position.y = -0.46;
      root.add(mid);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), SUIT_SHADE);
      mid.add(knee);
      mid.add(cap(0.085, 0.3, SUIT));
      const boot = box(0.16, 0.12, 0.3, GREY, 0.03);
      boot.position.set(0, -0.44, -0.05);
      mid.add(boot);
      const sole = box(0.17, 0.03, 0.31, DARK, 0.01);
      sole.position.set(0, -0.5, -0.05);
      mid.add(sole);
      return { root, mid };
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    // in first person the arms would sit right beside the lens; keep legs and boots
    this.fpHidden.push(this.armL.root, this.armR.root);
    this.legL = leg(-1);
    this.legR = leg(1);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /** First person: hide the helmet (the camera is inside it). */
  setFirstPerson(fp: boolean): void {
    for (const o of this.fpHidden) o.visible = !fp;
  }

  /**
   * speed: horizontal m/s; vy: vertical m/s; dt: s. Gait chosen from speed.
   * lookPitch tilts the torso a little so you can see your chest looking down.
   */
  animate(dt: number, speed: number, gait: Gait, vy: number): void {
    const k = Math.min(1, dt * 8);
    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, shL = 0, shR = 0, elb = 0.35, bobT = 0, lean = 0, crouchT = 0;
    if (gait === "walk") {
      this.phase += dt * (2.2 + speed * 1.6);
      const s = Math.sin(this.phase);
      hipL = s * 0.45; hipR = -s * 0.45;
      kneeL = Math.max(0, -Math.cos(this.phase)) * 0.7 + 0.05;
      kneeR = Math.max(0, Math.cos(this.phase)) * 0.7 + 0.05;
      shL = -s * 0.35; shR = s * 0.35;
      bobT = Math.abs(Math.sin(this.phase)) * 0.04;
      lean = 0.06;
    } else if (gait === "lope") {
      // both feet together, Apollo-style bunny hop
      this.phase += dt * 5.2;
      const s = Math.sin(this.phase);
      const air = Math.max(0, s);
      hipL = hipR = -0.25 + s * 0.35;
      kneeL = kneeR = 0.25 + (1 - air) * 0.55;
      shL = shR = 0.2 - s * 0.25;
      bobT = air * 0.28;
      lean = 0.16;
      crouchT = (1 - air) * 0.08;
    } else if (gait === "air") {
      hipL = -0.35; hipR = -0.15;
      kneeL = 0.6; kneeR = 0.35;
      shL = -0.5 + vy * 0.1; shR = -0.4 + vy * 0.1;
      elb = 0.6;
    } else {
      this.phase += dt * 1.2;
      bobT = Math.sin(this.phase) * 0.006;
      shL = 0.06; shR = 0.06;
      elb = 0.25;
    }
    const L = (a: number, b: number): number => a + (b - a) * k;
    this.legL.root.rotation.x = L(this.legL.root.rotation.x, hipL);
    this.legR.root.rotation.x = L(this.legR.root.rotation.x, hipR);
    this.legL.mid.rotation.x = L(this.legL.mid.rotation.x, -kneeL);
    this.legR.mid.rotation.x = L(this.legR.mid.rotation.x, -kneeR);
    this.armL.root.rotation.x = L(this.armL.root.rotation.x, shL);
    this.armR.root.rotation.x = L(this.armR.root.rotation.x, shR);
    this.armL.root.rotation.z = L(this.armL.root.rotation.z, -0.22);
    this.armR.root.rotation.z = L(this.armR.root.rotation.z, 0.22);
    this.armL.mid.rotation.x = L(this.armL.mid.rotation.x, elb);
    this.armR.mid.rotation.x = L(this.armR.mid.rotation.x, elb);
    this.bob = L(this.bob, bobT);
    this.crouch = L(this.crouch, crouchT);
    this.body.position.y = this.bob - this.crouch;
    this.torso.rotation.x = L(this.torso.rotation.x, -lean);
  }
}
