/**
 * The 3D Moon: CesiumJS with the Moon ellipsoid (no Earth globe, no atmosphere).
 *
 *  - With a Cesium ion token: Cesium Moon 3D Tiles (asset 2684829), collision on.
 *  - Without: a Moon globe with NASA Moon Trek LRO WAC imagery and, south of 80 S,
 *    real LOLA relief from the app's own 400 m terrain grid (CustomHeightmapTerrainProvider).
 *    Labelled as the fallback in the UI.
 *
 * Lighting uses the Horizons Sun direction in the Moon body-fixed frame, which is
 * also Cesium's fixed frame once the ellipsoid is the Moon. Earth is drawn as a lit
 * sphere at its Horizons position, so its phase in the sky is real geometry.
 */

import { sampleGrid, toPolarXY, type TerrainGrid } from "../science/terrain";
import type { Vec3 } from "../science/sky";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Cesium: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const MOON_R = 1_737_400;
const EYE = 1.62;
const ASTRO_SCALE = 1.8 / 74.26;
const ASTRO_HALF_HEIGHT = 0.9;
const G_MOON = 1.62;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface MoonOptions {
  container: string;
  token: string | null;
  grid: TerrainGrid | null;
  onPick: (lon: number, lat: number) => void;
  onWalkMove: (lon: number, lat: number) => void;
  onStatus: (msg: string) => void;
}

export type SceneMode = "surface" | "orbit" | "transit";

export class MoonScene {
  viewer: Any;
  tileset: Any = null;
  usingTiles = false;
  mode: SceneMode = "orbit";
  private astronaut: Any = null;
  private earth: Any = null;
  private sunGlow: Any = null;
  private pickMarker: Any = null;
  private walk = { lon: 0, lat: 0, heading: 0, pitch: -0.05, h: 0, vz: 0, z: 0, keys: new Set<string>(), last: 0, ground: 0 };
  private sunDir: Vec3 = [1, 0, 0];

  private constructor(private o: MoonOptions) {}

  static async create(o: MoonOptions): Promise<MoonScene> {
    const m = new MoonScene(o);
    await m.init();
    return m;
  }

  private async init(): Promise<void> {
    Cesium.Ellipsoid.default = Cesium.Ellipsoid.MOON;
    const common = {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, skyAtmosphere: false, skyBox: false, shadows: false,
      contextOptions: { webgl: { alpha: false } },
    };
    if (this.o.token) {
      try {
        Cesium.Ion.defaultAccessToken = this.o.token;
        this.viewer = new Cesium.Viewer(this.o.container, { ...common, globe: false, baseLayer: false });
        this.tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2684829, { enableCollision: true });
        this.viewer.scene.primitives.add(this.tileset);
        this.usingTiles = true;
      } catch (e) {
        this.o.onStatus(`Cesium Moon tiles unavailable (${(e as Error).message}); using NASA imagery fallback.`);
        try {
          this.viewer?.destroy();
        } catch {
          /* ignore */
        }
        this.viewer = null;
      }
    }
    if (!this.viewer) {
      const tiling = new Cesium.GeographicTilingScheme({ ellipsoid: Cesium.Ellipsoid.MOON });
      const imagery = new Cesium.UrlTemplateImageryProvider({
        url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
        tilingScheme: tiling,
        maximumLevel: 8,
        credit: new Cesium.Credit("NASA Moon Trek — LRO WAC global mosaic"),
      });
      this.viewer = new Cesium.Viewer(this.o.container, { ...common, baseLayer: new Cesium.ImageryLayer(imagery), terrainProvider: this.terrainProvider(tiling) });
      // South of 80 S, drape NASA LOLA shaded relief (Moon Trek's equirectangular tiles
      // smear near the pole). Visual aid only; the science reads the DEM directly.
      try {
        const relief = await Cesium.SingleTileImageryProvider.fromUrl("/data/terrain/south_pole_relief_geo.jpg", {
          rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, -80),
          credit: new Cesium.Credit("Shaded relief from NASA Goddard LOLA LDEM_80S_80MPP_ADJ"),
        });
        const layer = this.viewer.imageryLayers.addImageryProvider(relief);
        layer.alpha = 0.92;
      } catch {
        /* the WAC layer alone still works */
      }
      const globe = this.viewer.scene.globe;
      globe.enableLighting = true;
      globe.showGroundAtmosphere = false;
      globe.baseColor = Cesium.Color.fromCssColorString("#5a5752");
      globe.depthTestAgainstTerrain = true;
      globe.maximumScreenSpaceError = 2;
      globe.tileCacheSize = 400;
      // Cesium fades sun lighting out when the camera is close (to keep Earth's night
      // side readable). On the Moon the low polar Sun IS the subject, so keep it on.
      globe.lightingFadeOutDistance = 1;
      globe.lightingFadeInDistance = 2;
      globe.dynamicAtmosphereLighting = false;
    }
    const scene = this.viewer.scene;
    scene.backgroundColor = Cesium.Color.BLACK;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.light = new Cesium.DirectionalLight({ direction: new Cesium.Cartesian3(-1, 0, 0), intensity: 2.6 });
    scene.highDynamicRange = false;
    // Shadow maps at a 1-2 deg sun angle produce acne on the 400 m mesh, so the 3D view
    // does not claim shadow accuracy; the scanner's skyline is the measured answer.
    this.viewer.terrainShadows = Cesium.ShadowMode.DISABLED;
    if (this.viewer.shadowMap) {
      this.viewer.shadowMap.softShadows = true;
      this.viewer.shadowMap.size = 2048;
      this.viewer.shadowMap.maximumDistance = 20_000;
    }
    this.viewer.camera.frustum.far = 1e10;
    this.viewer.camera.frustum.near = 0.2;

    // Earth: a lit sphere at its true position; Sun: a glow far along the Sun direction.
    this.earth = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromElements(384_400_000, 0, 0),
      ellipsoid: { radii: new Cesium.Cartesian3(6_371_000, 6_371_000, 6_357_000), material: Cesium.Color.fromCssColorString("#4f86c6"), shadows: Cesium.ShadowMode.DISABLED },
      label: { text: "Earth", font: "600 13px Inter, sans-serif", fillColor: Cesium.Color.fromCssColorString("#a9cdf0"), pixelOffset: new Cesium.Cartesian2(0, -26), showBackground: false, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE },
    });
    this.sunGlow = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromElements(1e9, 0, 0),
      billboard: { image: sunSprite(), width: 96, height: 96, disableDepthTestDistance: 0 },
    });

    this.viewer.screenSpaceEventHandler.setInputAction((ev: Any) => this.handleClick(ev.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.viewer.scene.preRender.addEventListener(() => this.tick());
    this.bindKeys();
  }

  private terrainProvider(tiling: Any): Any {
    const grid = this.o.grid;
    if (!grid) return new Cesium.EllipsoidTerrainProvider({ ellipsoid: Cesium.Ellipsoid.MOON });
    const W = 33;
    return new Cesium.CustomHeightmapTerrainProvider({
      width: W,
      height: W,
      tilingScheme: tiling,
      callback: (x: number, y: number, level: number) => {
        const rect = tiling.tileXYToRectangle(x, y, level);
        const out = new Float32Array(W * W);
        if (rect.south * R2D > -79.0) return out; // tile entirely north of the LOLA grid: smooth sphere
        for (let r = 0; r < W; r++) {
          const lat = (rect.north + (rect.south - rect.north) * (r / (W - 1))) * R2D;
          for (let c = 0; c < W; c++) {
            const lon = (rect.west + (rect.east - rect.west) * (c / (W - 1))) * R2D;
            if (lat > -79.5) continue;
            const [px, py] = toPolarXY(lon, lat);
            const h = sampleGrid(grid, px, py);
            out[r * W + c] = Number.isNaN(h) ? 0 : h;
          }
        }
        return out;
      },
    });
  }

  /** Point Sun light and place Sun/Earth markers (Moon body-fixed vectors, km). */
  setSky(sunKm: Vec3, earthKm: Vec3): void {
    const n = Math.hypot(...sunKm);
    this.sunDir = [sunKm[0] / n, sunKm[1] / n, sunKm[2] / n];
    this.viewer.scene.light.direction = new Cesium.Cartesian3(-this.sunDir[0], -this.sunDir[1], -this.sunDir[2]);
    this.sunGlow.position = Cesium.Cartesian3.fromElements(this.sunDir[0] * 2e9, this.sunDir[1] * 2e9, this.sunDir[2] * 2e9);
    this.earth.position = Cesium.Cartesian3.fromElements(earthKm[0] * 1000, earthKm[1] * 1000, earthKm[2] * 1000);
    this.viewer.scene.requestRender();
  }

  // ── Picking & orbit ─────────────────────────────────────────────────────
  private handleClick(pos: Any): void {
    if (this.mode === "surface") {
      this.lockPointer();
      return;
    }
    if (this.mode !== "orbit") return;
    let cart = this.viewer.scene.pickPositionSupported ? this.viewer.scene.pickPosition(pos) : undefined;
    if (!cart) cart = this.viewer.camera.pickEllipsoid(pos, Cesium.Ellipsoid.MOON);
    if (!cart) return;
    const c = Cesium.Cartographic.fromCartesian(cart, Cesium.Ellipsoid.MOON);
    if (!c) return;
    this.showPick(c.longitude * R2D, c.latitude * R2D);
    this.o.onPick(((c.longitude * R2D) + 360) % 360, c.latitude * R2D);
  }

  showPick(lon: number, lat: number): void {
    if (this.pickMarker) this.viewer.entities.remove(this.pickMarker);
    this.pickMarker = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0, Cesium.Ellipsoid.MOON),
      point: { pixelSize: 12, color: Cesium.Color.fromCssColorString("#f2b544"), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
  }

  private markers: Any[] = [];
  addSiteMarkers(sites: { lon: number; lat: number; short: string }[]): void {
    for (const s of sites) {
      this.markers.push(this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0, Cesium.Ellipsoid.MOON),
        point: { pixelSize: 8, color: Cesium.Color.fromCssColorString("#ece6da"), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: s.short, font: "600 12px Inter, sans-serif", fillColor: Cesium.Color.fromCssColorString("#ece6da"), outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(10, -10), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6e6),
        },
        show: this.mode !== "surface",
      }));
    }
  }

  /** Orbit view over a point (cinematic ascent when coming from the surface). */
  async toOrbit(lon: number, lat: number, fromSurface: boolean): Promise<void> {
    this.setMode("transit");
    this.releasePointer();
    const cam = this.viewer.camera;
    if (fromSurface) {
      await this.fly(Cesium.Cartesian3.fromDegrees(lon, lat, 60_000, Cesium.Ellipsoid.MOON), { heading: cam.heading, pitch: -Math.PI / 2 + 0.2, roll: 0 }, 2.2);
    }
    await this.fly(Cesium.Cartesian3.fromDegrees(lon, lat, 3_000_000, Cesium.Ellipsoid.MOON), { heading: 0, pitch: -Math.PI / 2, roll: 0 }, fromSurface ? 3.2 : 1.6);
    this.setMode("orbit");
  }

  /** Descend to a point and hand over to first person. */
  async land(lon: number, lat: number): Promise<void> {
    this.setMode("transit");
    const hGuess = this.groundAt(lon, lat) ?? 0;
    await this.fly(Cesium.Cartesian3.fromDegrees(lon, lat, hGuess + 40_000, Cesium.Ellipsoid.MOON), { heading: 0, pitch: -Math.PI / 2 + 0.05, roll: 0 }, 3.0);
    await this.fly(Cesium.Cartesian3.fromDegrees(lon, lat, hGuess + 600, Cesium.Ellipsoid.MOON), { heading: 0, pitch: -0.5, roll: 0 }, 2.2);
    if (this.pickMarker) {
      this.viewer.entities.remove(this.pickMarker);
      this.pickMarker = null;
    }
    this.startWalk(lon, lat, 0);
  }

  private fly(dest: Any, orientation: Any, duration: number): Promise<void> {
    return new Promise((resolve) => {
      this.viewer.camera.flyTo({ destination: dest, orientation, duration, easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT, complete: resolve, cancel: resolve });
    });
  }

  private setMode(m: SceneMode): void {
    this.mode = m;
    const ctl = this.viewer.scene.screenSpaceCameraController;
    const free = m === "orbit";
    ctl.enableRotate = free;
    ctl.enableTranslate = free;
    ctl.enableZoom = free;
    ctl.enableTilt = free;
    ctl.enableLook = free;
    if (this.astronaut) this.astronaut.show = m === "surface";
    for (const mk of this.markers) mk.show = m !== "surface";
    // Orbit: real day/night terminator from the Horizons Sun. Surface: the imagery's
    // own shading plus shadows cast by the terrain from the same Sun direction, so a
    // grazing polar Sun stays readable instead of turning the ground black.
    if (this.viewer.scene.globe) this.viewer.scene.globe.enableLighting = m !== "surface";
    // On foot, clip the inside of our own helmet (within 35 cm of the eye) but keep the
    // chest, legs and boots, which are 0.5-1.7 m away when looking down.
    this.viewer.camera.frustum.near = m === "surface" ? 0.35 : 1.0;
  }

  // ── First person ────────────────────────────────────────────────────────
  startWalk(lon: number, lat: number, heading: number): void {
    const w = this.walk;
    w.lon = lon;
    w.lat = lat;
    w.heading = heading;
    w.pitch = -0.08;
    w.vz = 0;
    w.z = 0;
    w.last = performance.now();
    w.ground = this.groundAt(lon, lat) ?? 0;
    this.ensureAstronaut();
    this.setMode("surface");
    this.o.onWalkMove(lon, lat);
  }

  private ensureAstronaut(): void {
    if (this.astronaut) return;
    this.astronaut = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0, 0, Cesium.Ellipsoid.MOON),
      // NASA 3D Resources astronaut: ~74 model units tall, origin at its centre.
      model: { uri: "/models/astronaut.glb", scale: ASTRO_SCALE, minimumPixelSize: 0, shadows: Cesium.ShadowMode.ENABLED },
    });
  }

  /** Height of the rendered surface (m above the Moon sphere), or the LOLA grid, or null. */
  groundAt(lon: number, lat: number): number | null {
    const carto = Cesium.Cartographic.fromDegrees(lon, lat, 0);
    if (this.usingTiles) {
      const h = this.viewer.scene.sampleHeight(carto, this.astronaut ? [this.astronaut] : undefined);
      if (h !== undefined) return h;
    } else {
      const h = this.viewer.scene.globe.getHeight(carto);
      if (h !== undefined) return h;
    }
    if (this.o.grid && lat <= -79.5) {
      const [x, y] = toPolarXY(lon, lat);
      const h = sampleGrid(this.o.grid, x, y);
      if (!Number.isNaN(h)) return h;
    }
    return null;
  }

  private tick(): void {
    if (this.mode !== "surface") return;
    const w = this.walk;
    const now = performance.now();
    const dt = Math.min(0.1, (now - w.last) / 1000);
    w.last = now;
    const k = w.keys;
    const run = k.has("ShiftLeft") || k.has("ShiftRight");
    const speed = run ? 60 : 6; // m/s; "run" is a rover-speed boost so distances on a Moon-sized world stay explorable
    let f = 0;
    let s = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) f += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) f -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) s += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) s -= 1;
    if (k.has("KeyQ")) w.heading -= 1.6 * dt;
    if (k.has("KeyE")) w.heading += 1.6 * dt;
    if (f || s) {
      const len = Math.hypot(f, s);
      const dist = (speed * dt) / len;
      const bearing = w.heading + Math.atan2(s, f);
      const [lon2, lat2, finalBearing] = greatCircle(w.lon, w.lat, bearing, dist * Math.hypot(f, s));
      w.heading += finalBearing - bearing; // keep facing the same way across meridians and the pole
      w.lon = lon2;
      w.lat = lat2;
      this.o.onWalkMove(w.lon, w.lat);
    }
    const g = this.groundAt(w.lon, w.lat);
    if (g !== null) w.ground = w.ground + (g - w.ground) * Math.min(1, dt * 12);
    // Lunar hop
    if (k.has("Space") && w.z <= 0.001) w.vz = 2.2;
    w.vz -= G_MOON * dt;
    w.z = Math.max(0, w.z + w.vz * dt);
    if (w.z === 0 && w.vz < 0) w.vz = 0;
    const cam = this.viewer.camera;
    const eye = Cesium.Cartesian3.fromDegrees(w.lon, w.lat, w.ground + EYE + w.z, Cesium.Ellipsoid.MOON);
    cam.setView({ destination: eye, orientation: { heading: w.heading, pitch: w.pitch, roll: 0 } });
    if (this.astronaut) {
      // Body slightly behind the eye so looking down shows chest, legs and boots.
      // Only when looking down: the model is T-posed, so its arms would block a level view.
      this.astronaut.show = w.pitch < -0.5;
      const [blon, blat] = greatCircle(w.lon, w.lat, w.heading + Math.PI, 0.1);
      const feet = Cesium.Cartesian3.fromDegrees(blon, blat, w.ground + w.z + ASTRO_HALF_HEIGHT, Cesium.Ellipsoid.MOON);
      this.astronaut.position = feet;
      this.astronaut.orientation = Cesium.Transforms.headingPitchRollQuaternion(feet, new Cesium.HeadingPitchRoll(w.heading - Math.PI / 2, 0, 0), Cesium.Ellipsoid.MOON);
    }
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (this.mode !== "surface") return;
      if ((e.target as HTMLElement)?.closest?.("input, select, textarea")) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "KeyQ", "KeyE"].includes(e.code)) {
        this.walk.keys.add(e.code);
        if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.walk.keys.delete(e.code));
    window.addEventListener("blur", () => this.walk.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (this.mode !== "surface" || document.pointerLockElement !== this.viewer.canvas) return;
      this.walk.heading += e.movementX * 0.0022;
      this.walk.pitch = Math.max(-1.45, Math.min(1.3, this.walk.pitch - e.movementY * 0.0022));
    });
  }

  lockPointer(): void {
    this.viewer.canvas.requestPointerLock?.();
  }
  releasePointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Aim the first-person camera (used by the guided demo). */
  look(heading: number, pitch: number): void {
    this.walk.heading = heading;
    this.walk.pitch = pitch;
  }
  get walkState(): { lon: number; lat: number; heading: number } {
    return { lon: this.walk.lon, lat: this.walk.lat, heading: this.walk.heading };
  }
}

/** Great-circle step on the sphere: returns lon, lat (deg) and the final bearing (rad). */
export function greatCircle(lonDeg: number, latDeg: number, bearing: number, distM: number): [number, number, number] {
  const phi1 = latDeg * D2R;
  const lam1 = lonDeg * D2R;
  const d = distM / MOON_R;
  const sinPhi2 = Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(bearing);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lam2 = lam1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * sinPhi2);
  // Final bearing = reverse of the initial bearing from the end point back to the start, plus 180.
  const y = Math.sin(lam1 - lam2) * Math.cos(phi1);
  const x = Math.cos(phi2) * Math.sin(phi1) - Math.sin(phi2) * Math.cos(phi1) * Math.cos(lam1 - lam2);
  const back = Math.atan2(y, x);
  let lon = lam2 * R2D;
  lon = ((lon % 360) + 360) % 360;
  return [lon, phi2 * R2D, back + Math.PI];
}

function sunSprite(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,250,1)");
  r.addColorStop(0.12, "rgba(255,247,225,1)");
  r.addColorStop(0.2, "rgba(255,226,160,0.55)");
  r.addColorStop(0.5, "rgba(255,200,120,0.12)");
  r.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return c;
}
