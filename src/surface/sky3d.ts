// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The lunar sky, drawn in its own scene on a 1000-unit dome around the camera
 * (rotation only), then the world is drawn over it — so terrain hides the Sun
 * and Earth exactly where it rises above them.
 *
 * Positions are not decorative: Sun and Earth directions come from the NASA/JPL
 * Horizons table via the same `azElOf` the scanner uses. Earth's apparent size uses
 * the Horizons Earth–Moon distance; its phase comes from lighting it from the
 * Sun's direction. Black sky: the Moon has no atmosphere to scatter light.
 * The star field is decorative (random, not a catalogue) and is labelled so.
 */

import * as THREE from "three";

const DOME = 1000;
const D2R = Math.PI / 180;

export function dirFromAzEl(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = az * D2R, e = el * D2R;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function sunTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.07, "rgba(255,253,245,1)");
  grd.addColorStop(0.085, "rgba(255,240,210,0.55)");
  grd.addColorStop(0.2, "rgba(255,220,170,0.16)");
  grd.addColorStop(0.5, "rgba(255,200,140,0.04)");
  grd.addColorStop(1, "rgba(255,200,140,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly overlay = new THREE.Scene();
  private sun: THREE.Sprite;
  private earth: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private sunPath: THREE.Group = new THREE.Group();
  private skyline: THREE.Line | null = null;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly earthDir = new THREE.Vector3(0, 1, 0);

  constructor(fov: number) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(fov, 1, 1, DOME * 3);
    // Decorative star field (not a star catalogue).
    const r = rng(7);
    const n = 5000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(th) * DOME * 1.5, u * DOME * 1.5, s * Math.sin(th) * DOME * 1.5], i * 3);
      const b = Math.pow(r(), 6) * 0.9 + 0.08;
      const t = r();
      col.set([b * (t < 0.2 ? 0.8 : 1), b * 0.95, b * (t > 0.8 ? 0.8 : 1)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTexture(), color: 0xffffff, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.sun);

    const tex = new THREE.TextureLoader().load("/textures/earth_bluemarble_2048.jpg");
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, rot: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec2 vUv;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 sunDir; uniform float rot; varying vec3 vN; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.1; a*=.5; } return s; }
        void main(){
          vec3 day = texture2D(map, vUv).rgb;
          // illustrative cloud layer (procedural, not observed weather)
          vec2 cp = vec2(vUv.x * 12.0, vUv.y * 6.0);
          float lat = abs(vUv.y - 0.5) * 2.0;
          float band = 0.55 + 0.25 * smoothstep(0.25, 0.6, lat) - 0.2 * smoothstep(0.0, 0.2, 0.25 - abs(lat - 0.3));
          float c = smoothstep(band, band + 0.25, fbm(cp + fbm(cp * 1.7) * 1.3));
          vec3 col = mix(day, vec3(0.95), c * 0.85);
          float l = dot(normalize(vN), normalize(sunDir));
          float lit = smoothstep(-0.05, 0.12, l);
          float limb = pow(1.0 - abs(dot(normalize(vN), vec3(0.0,0.0,1.0))), 3.0);
          vec3 atm = vec3(0.35, 0.55, 1.0) * limb * 0.25 * lit;
          gl_FragColor = vec4(col * (0.04 + 1.15 * max(l, 0.0)) * lit + atm, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.earthMat);
    this.scene.add(this.earth);
    this.overlay.add(this.sunPath);
  }

  /** Sun/Earth placement. distKm = Earth–Moon distance (Horizons). */
  update(sunAz: number, sunEl: number, earthAz: number, earthEl: number, distKm: number, utcSeconds: number): void {
    dirFromAzEl(sunAz, sunEl, this.sunDir);
    dirFromAzEl(earthAz, earthEl, this.earthDir);
    // The real disc is 0.53° wide; the glow sprite is drawn ~12x larger so the
    // disc (inner 7 % of the texture) keeps its true size.
    const sunR = Math.tan(0.2666 * D2R) * DOME;
    this.sun.position.copy(this.sunDir).multiplyScalar(DOME);
    this.sun.scale.setScalar((sunR / 0.075) * 1.0);
    const earthRad = Math.atan(6371 / distKm);
    this.earth.position.copy(this.earthDir).multiplyScalar(DOME);
    this.earth.scale.setScalar(Math.tan(earthRad) * DOME);
    // Earth's spin: the face toward the Moon follows sidereal time (illustrative
    // orientation — the cloud layer and axis roll are not modelled).
    const days = utcSeconds / 86400 - 10957.5;
    const gmst = (280.46061837 + 360.98564736629 * days) % 360;
    this.earth.rotation.set(0, (-gmst * D2R) % (Math.PI * 2), 0);
    this.earthMat.uniforms.sunDir!.value.copy(this.sunDir);
  }

  /** Fraction of Earth's disc that is sunlit, as seen from here (0 = new, 1 = full). */
  earthLitFraction(): number {
    // phase angle at Earth ≈ angle between (Earth→Sun) and (Earth→Moon) ≈ 180° − angle(sun, earth) seen from the Moon
    const cosA = -this.sunDir.dot(this.earthDir);
    return (1 + cosA) / 2;
  }

  /** Path of the Sun (or Earth) across the sky, coloured by visibility. */
  setPath(points: { az: number; el: number; visible: boolean }[] | null, color: number): void {
    for (const c of [...this.sunPath.children]) {
      this.sunPath.remove(c);
      const m = c as THREE.Line;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    if (!points || points.length < 2) return;
    const segs: { vis: boolean; pts: THREE.Vector3[] }[] = [];
    for (const p of points) {
      const v = dirFromAzEl(p.az, p.el).multiplyScalar(DOME * 0.98);
      const last = segs[segs.length - 1];
      if (!last || last.vis !== p.visible) {
        const s = { vis: p.visible, pts: last ? [last.pts[last.pts.length - 1] as THREE.Vector3] : [] };
        segs.push(s);
      }
      (segs[segs.length - 1] as { pts: THREE.Vector3[] }).pts.push(v);
    }
    for (const s of segs) {
      if (s.pts.length < 2) continue;
      const g = new THREE.BufferGeometry().setFromPoints(s.pts);
      const m = s.vis
        ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false })
        : new THREE.LineDashedMaterial({ color: 0xff6a5a, dashSize: 6, gapSize: 6, transparent: true, opacity: 0.75, depthTest: false });
      const l = new THREE.Line(g, m);
      if (!s.vis) l.computeLineDistances();
      this.sunPath.add(l);
    }
  }

  /** The scientific LOLA skyline, traced over the 3D terrain (toggle). */
  setSkyline(horizonDeg: ArrayLike<number> | null): void {
    if (this.skyline) {
      this.overlay.remove(this.skyline);
      this.skyline.geometry.dispose();
      this.skyline = null;
    }
    if (!horizonDeg) return;
    const pts: THREE.Vector3[] = [];
    const n = horizonDeg.length;
    for (let i = 0; i <= n; i++) pts.push(dirFromAzEl((i % n) * (360 / n), horizonDeg[i % n] as number).multiplyScalar(DOME * 0.97));
    this.skyline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x7fe0d0, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.overlay.add(this.skyline);
  }

  syncCamera(cam: THREE.PerspectiveCamera): void {
    this.camera.quaternion.copy(cam.quaternion);
    if (this.camera.fov !== cam.fov || this.camera.aspect !== cam.aspect) {
      this.camera.fov = cam.fov;
      this.camera.aspect = cam.aspect;
      this.camera.updateProjectionMatrix();
    }
  }
}
