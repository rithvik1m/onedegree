// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * GLB asset loading. Models: Quaternius "Ultimate Space Kit", CC0 (public/models/kit/LICENSE.md).
 * Each model is normalised to a real-world size, set to cast/receive shadows, and its
 * materials get the distant-horizon sun gate, so buildings are lit by the same Sun
 * the science uses.
 */

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { gated } from "./materials";

export const KIT = [
  "astronaut", "rover", "base_large", "building_l", "house_long", "house_cylinder", "geodesic_dome",
  "solar_panel_structure", "solar_panel_ground", "roof_radar", "roof_antenna", "rock", "rock_2",
  "rock_large", "rock_large_2", "pickup_crate", "stairs", "house_single_support",
] as const;
export type KitName = (typeof KIT)[number];

const loader = new GLTFLoader();
const cache = new Map<KitName, GLTF>();

export async function loadKit(onProgress?: (done: number, total: number) => void): Promise<Map<KitName, GLTF>> {
  let done = 0;
  await Promise.all(
    KIT.map(async (n) => {
      const g = await loader.loadAsync(`/models/kit/${n}.glb`);
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) gated(mat as THREE.MeshStandardMaterial);
      });
      cache.set(n, g);
      onProgress?.(++done, KIT.length);
    }),
  );
  return cache;
}

export function kit(n: KitName): GLTF {
  const g = cache.get(n);
  if (!g) throw new Error(`model ${n} not loaded`);
  return g;
}

/** A copy of a static model scaled so its largest horizontal extent (or height) equals `size` metres, base on y = 0. */
export function placeable(n: KitName, size: number, by: "width" | "height" = "width"): THREE.Group {
  const src = kit(n).scene;
  const obj = src.clone(true);
  const box = new THREE.Box3().setFromObject(obj);
  const sz = box.getSize(new THREE.Vector3());
  const k = by === "height" ? size / sz.y : size / Math.max(sz.x, sz.z);
  obj.scale.multiplyScalar(k);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c = box2.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box2.min.y, -c.z);
  const g = new THREE.Group();
  g.add(obj);
  g.userData.size = box2.getSize(new THREE.Vector3());
  return g;
}

/** Tint every material of a model (clones the materials first). */
export function tint(o: THREE.Object3D, color: number, mix = 0.5, dropMap = false): void {
  const c = new THREE.Color(color);
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    gated(mat);
    if (dropMap) {
      mat.map = null;
      mat.color.copy(c);
      mat.roughness = 0.95;
    } else mat.color.lerp(c, mix);
    m.material = mat;
  });
}
