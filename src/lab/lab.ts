// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/** Physics Lab: Rapier rigid-body rover on real LOLA terrain + a lunar drop experiment (prototype). */
import * as THREE from "three";
import { DEFAULT_ROVER, G_MOON, PhysicsManager, driveVehicle, initPhysics } from "../physics/manager";
import { groundY, loadPatch } from "../surface/terrain3d";

const stats = document.getElementById("stats") as HTMLElement;
await initPhysics();
const patch = await loadPatch("outpost");
const ground = (x: number, z: number): number => groundY(patch, x, z);
const CX = 40, CZ = -40, N = 120, CELL = 2;

const pm = new PhysicsManager({ siteGroundM: patch.groundM });
pm.addTerrain(ground, CX, CZ, N, CELL);
let rover = pm.addVehicle(CX, ground(CX, CZ) + 2.2, CZ);

// --- rendering
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
scene.add(new THREE.AmbientLight(0x8e95a6, 0.6));
const sun = new THREE.DirectionalLight(0xfff4e6, 3);
sun.position.set(-200, 60, 80);
scene.add(sun);
// terrain mesh from exactly the heights the collider uses
const tg = new THREE.PlaneGeometry(N * CELL, N * CELL, N, N);
tg.rotateX(-Math.PI / 2);
const tp = tg.getAttribute("position") as THREE.BufferAttribute;
for (let i = 0; i < tp.count; i++) tp.setY(i, ground(CX + tp.getX(i), CZ + tp.getZ(i)));
tg.computeVertexNormals();
const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x9a968f, roughness: 1 }));
terrain.position.set(CX, 0, CZ);
scene.add(terrain);
const [hx, hy, hz] = DEFAULT_ROVER.halfExtents;
const chassisMesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), new THREE.MeshStandardMaterial({ color: 0xe4e1da, roughness: 0.6 }));
scene.add(chassisMesh);
const wheels = DEFAULT_ROVER.wheels.map(() => {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(DEFAULT_ROVER.wheelRadius, DEFAULT_ROVER.wheelRadius, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8 }));
  w.geometry.rotateZ(Math.PI / 2);
  scene.add(w);
  return w;
});
let balls: { body: ReturnType<PhysicsManager["addBall"]>; mesh: THREE.Mesh; mass: number; t0: number; landed: number | null }[] = [];
let simT = 0;
const keys = new Set<string>();
let assist: "explorer" | "simulation" = "explorer";
addEventListener("keydown", (e: KeyboardEvent) => {
  keys.add(e.code);
  if (e.code === "KeyX") assist = assist === "explorer" ? "simulation" : "explorer";
  if (e.code === "KeyR") { pm.world.removeRigidBody(rover.chassis); rover = pm.addVehicle(CX, ground(CX, CZ) + 2.2, CZ); }
  if (e.code === "KeyT") dropTest();
});
addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.code));
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });

function dropTest(): void {
  for (const b of balls) { pm.world.removeRigidBody(b.body); scene.remove(b.mesh); }
  const p = rover.chassis.translation();
  balls = [1, 100].map((mass, i) => {
    const x = p.x + 8 + i * 3, z = p.z;
    const body = pm.addBall(x, ground(x, z) + 10 + 0.3, z, 0.3, mass);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: i ? 0xd8642e : 0x6fa8dc }));
    scene.add(mesh);
    return { body, mesh, mass, t0: simT, landed: null };
  });
}
(window as unknown as { lab: unknown }).lab = { pm, get rover() { return rover; }, dropTest, get balls() { return balls; } };

let last = performance.now();
let stepAvg = 0;
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const steer = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const thr = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") && rover.vc.currentVehicleSpeed() < 0.5 ? 0.6 : 0);
  const brake = keys.has("KeyS") && rover.vc.currentVehicleSpeed() > 0.5 ? 1 : keys.has("Space") ? 1 : 0;
  pm.step(dt, (h) => { driveVehicle(rover, steer, thr, brake, assist); rover.vc.updateVehicle(h); simT += h; });
  stepAvg += (pm.stepMs - stepAvg) * 0.05;
  const t = rover.chassis.translation(), q = rover.chassis.rotation();
  chassisMesh.position.set(t.x, t.y, t.z);
  chassisMesh.quaternion.set(q.x, q.y, q.z, q.w);
  wheels.forEach((w, i) => {
    const c = rover.vc.wheelChassisConnectionPointCs(i);
    const s = rover.vc.wheelSuspensionLength(i) ?? DEFAULT_ROVER.suspensionRest;
    if (!c) return;
    const local = new THREE.Vector3(c.x, c.y - s, c.z).applyQuaternion(chassisMesh.quaternion).add(chassisMesh.position);
    w.position.copy(local);
    w.quaternion.copy(chassisMesh.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rover.vc.wheelSteering(i) ?? 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rover.vc.wheelRotation(i) ?? 0));
  });
  for (const b of balls) {
    const p = b.body.translation();
    b.mesh.position.set(p.x, p.y, p.z);
    if (b.landed === null && p.y - 0.3 <= ground(p.x, p.z) + 0.02) b.landed = simT - b.t0;
  }
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(chassisMesh.quaternion).setY(0).normalize();
  const want = chassisMesh.position.clone().addScaledVector(fwd, -11).add(new THREE.Vector3(0, 4.5, 0));
  want.y = Math.max(want.y, ground(want.x, want.z) + 1.5);
  cam.position.lerp(want, 1 - Math.exp(-5 * dt));
  cam.lookAt(chassisMesh.position.clone().addScaledVector(fwd, 6));
  renderer.render(scene, cam);
  const susp = [0, 1, 2, 3].map((i) => (rover.vc.wheelSuspensionLength(i) ?? 0).toFixed(2)).join(" ");
  const contact = [0, 1, 2, 3].map((i) => (rover.vc.wheelIsInContact(i) ? "●" : "○")).join("");
  const theory = Math.sqrt((2 * 10) / G_MOON);
  stats.textContent =
    `physics step  ${stepAvg.toFixed(3)} ms/frame · ${pm.substeps} substep(s) @ 1/60 s\n` +
    `rover         ${(rover.vc.currentVehicleSpeed() * 3.6).toFixed(1)} km/h · assist ${assist}\n` +
    `wheels        ${contact} · suspension ${susp} m\n` +
    `drop test     ${balls.length ? balls.map((b) => `${b.mass} kg: ${b.landed === null ? "falling…" : b.landed.toFixed(2) + " s"}`).join(" · ") : "press T"}  (theory ${theory.toFixed(2)} s)`;
}
frame();
