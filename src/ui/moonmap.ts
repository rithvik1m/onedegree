// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Exploration map: an orthographic Moon globe (drag to rotate, wheel / buttons to zoom)
 * drawn from NASA's LRO LROC WAC colour mosaic (NASA SVS CGI Moon Kit). Markers cluster
 * when they would overlap; click a cluster to zoom in. Complements the science planner.
 */
const D2R = Math.PI / 180;
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export type MapCat = "base" | "historic" | "site" | "objective" | "discovery" | "custom" | "you" | "craft";

export interface MapItem {
  id: string;
  name: string;
  lon: number;
  lat: number;
  cat: MapCat;
  desc?: string;
  meta?: string;
  status?: string;
}

export interface MapAction {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  fn: () => void;
}

const CAT: Record<MapCat, { color: string; label: string; shape: "sq" | "di" | "ci" | "ring" | "star" | "plus" | "you" | "tri" }> = {
  base: { color: "#ffb347", label: "Research bases (fictional)", shape: "sq" },
  historic: { color: "#f2efe8", label: "Apollo sites (historic)", shape: "di" },
  site: { color: "#6fa8dc", label: "Real landing & survey sites", shape: "ci" },
  objective: { color: "#7fe0d0", label: "Mission objectives", shape: "ring" },
  discovery: { color: "#ffd66b", label: "Your discoveries", shape: "star" },
  custom: { color: "#e07fd8", label: "Custom point", shape: "plus" },
  you: { color: "#7fe0a0", label: "You", shape: "you" },
  craft: { color: "#ffffff", label: "Your spacecraft", shape: "tri" },
};

export class MoonMap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: ImageData | null = null;
  private lon0 = 0;
  private lat0 = -60;
  private zoom = 1;
  private sel: MapItem | null = null;
  private custom: MapItem | null = null;
  private filters = new Set<MapCat>(["base", "historic", "site", "objective", "discovery", "custom", "you", "craft"]);
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private hits: { x: number; y: number; items: MapItem[] }[] = [];
  private lowRes = false;
  private raf = 0;

  constructor(private opts: { items: () => MapItem[]; actions: (it: MapItem) => MapAction[]; info?: () => string }) {
    this.cv = $("mmCanvas") as HTMLCanvasElement;
    this.ctx = this.cv.getContext("2d", { willReadFrequently: false }) as CanvasRenderingContext2D;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d") as CanvasRenderingContext2D;
      x.drawImage(img, 0, 0);
      this.tex = x.getImageData(0, 0, c.width, c.height);
      if (this.isOpen()) this.draw();
    };
    img.src = "textures/moon_lroc_2048.jpg";
    this.cv.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      this.cv.setPointerCapture(e.pointerId);
    });
    this.cv.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      if (!this.drag.moved) return;
      const R = this.radius();
      this.lon0 -= (dx / R) / D2R / Math.max(0.2, Math.cos(this.lat0 * D2R)) * 0.9;
      this.lat0 = Math.max(-90, Math.min(90, this.lat0 + (dy / R) / D2R * 0.9));
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.lowRes = true;
      this.schedule();
    });
    this.cv.addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      this.lowRes = false;
      if (d && !d.moved) this.click(e);
      this.schedule();
    });
    this.cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    $("mmZoomIn").addEventListener("click", () => this.setZoom(this.zoom * 2));
    $("mmZoomOut").addEventListener("click", () => this.setZoom(this.zoom / 2));
    $("mmPole").addEventListener("click", () => { this.lon0 = 0; this.lat0 = -90; this.setZoom(30); });
    $("mmGlobe").addEventListener("click", () => { this.lat0 = -40; this.setZoom(1); });
    $("mmClose").addEventListener("click", () => this.close());
    const fl = $("mmFilters");
    fl.innerHTML = (Object.keys(CAT) as MapCat[]).map((k) => `<label class="mm-f"><input type="checkbox" data-c="${k}" checked /><span class="mm-sw" style="--c:${CAT[k].color}"></span>${CAT[k].label}</label>`).join("");
    for (const i of fl.querySelectorAll<HTMLInputElement>("input")) i.addEventListener("change", () => {
      const c = i.dataset.c as MapCat;
      if (i.checked) this.filters.add(c); else this.filters.delete(c);
      this.schedule();
    });
    window.addEventListener("resize", () => { if (this.isOpen()) this.schedule(); });
  }

  isOpen(): boolean {
    return !$("moonMap").classList.contains("hidden");
  }

  open(focus?: { lon: number; lat: number; zoom?: number }): void {
    if (document.pointerLockElement) document.exitPointerLock();
    $("moonMap").classList.remove("hidden");
    if (focus) {
      this.lon0 = focus.lon;
      this.lat0 = focus.lat;
      this.zoom = focus.zoom ?? this.zoom;
    }
    this.size();
    this.draw();
    this.renderSide();
  }

  close(): void {
    $("moonMap").classList.add("hidden");
  }

  toggle(focus?: { lon: number; lat: number; zoom?: number }): void {
    if (this.isOpen()) this.close();
    else this.open(focus);
  }

  select(it: MapItem | null): void {
    this.sel = it;
    this.renderSide();
    this.schedule();
  }

  refresh(): void {
    if (!this.isOpen()) return;
    this.renderSide();
    this.schedule();
  }

  private setZoom(z: number): void {
    this.zoom = Math.max(1, Math.min(900, z));
    this.schedule();
  }

  private size(): void {
    const box = this.cv.parentElement as HTMLElement;
    const s = Math.floor(Math.max(240, Math.min(box.clientWidth, box.clientHeight || box.clientWidth)));
    if (this.cv.width !== s) {
      this.cv.width = s;
      this.cv.height = s;
    }
  }

  private radius(): number {
    return (this.cv.width / 2) * 0.92 * this.zoom;
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.size();
      this.draw();
    });
  }

  /** screen position of (lon, lat), or null if on the far side */
  private project(lon: number, lat: number): { x: number; y: number } | null {
    const p0 = this.lat0 * D2R, p = lat * D2R, dl = (lon - this.lon0) * D2R;
    const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl);
    if (cosc < 0) return null;
    const R = this.radius();
    const x = Math.cos(p) * Math.sin(dl);
    const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl);
    return { x: this.cv.width / 2 + x * R, y: this.cv.height / 2 - y * R };
  }

  private unproject(px: number, py: number): { lon: number; lat: number } | null {
    const R = this.radius();
    const x = (px - this.cv.width / 2) / R, y = (this.cv.height / 2 - py) / R;
    const rho = Math.hypot(x, y);
    if (rho > 1) return null;
    if (rho < 1e-9) return { lon: this.lon0, lat: this.lat0 };
    const c = Math.asin(rho), p0 = this.lat0 * D2R;
    const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho) / D2R;
    const lon = this.lon0 + Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(p0) - y * Math.sin(c) * Math.sin(p0)) / D2R;
    return { lon: ((lon + 540) % 360) - 180, lat };
  }

  private draw(): void {
    const W = this.cv.width, H = this.cv.height;
    const step = this.lowRes ? 3 : 1;
    const w = Math.ceil(W / step), h = Math.ceil(H / step);
    const out = this.ctx.createImageData(w, h);
    const o = out.data;
    const t = this.tex;
    const R = this.radius() / step;
    const cx = w / 2, cy = h / 2;
    const p0 = this.lat0 * D2R, s0 = Math.sin(p0), c0 = Math.cos(p0);
    for (let j = 0; j < h; j++) {
      const y = (cy - j - 0.5) / R;
      for (let i = 0; i < w; i++) {
        const x = (i + 0.5 - cx) / R;
        const r2 = x * x + y * y;
        const k = (j * w + i) * 4;
        if (r2 > 1) { o[k] = 6; o[k + 1] = 7; o[k + 2] = 9; o[k + 3] = 255; continue; }
        const rho = Math.sqrt(r2);
        const cz = Math.sqrt(1 - r2); // cos c
        const sc = rho; // sin c
        const lat = Math.asin(Math.max(-1, Math.min(1, cz * s0 + (rho > 0 ? (y * sc * c0) / rho : 0))));
        const lon = this.lon0 * D2R + Math.atan2(x * sc, rho * cz * c0 - y * sc * s0);
        const shade = 0.5 + 0.5 * cz;
        if (t) {
          let u = ((lon / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
          const v = 0.5 - lat / Math.PI;
          const tx = Math.min(t.width - 1, Math.floor(u * t.width)), ty = Math.min(t.height - 1, Math.max(0, Math.floor(v * t.height)));
          const q = (ty * t.width + tx) * 4;
          o[k] = (t.data[q] as number) * shade;
          o[k + 1] = (t.data[q + 1] as number) * shade;
          o[k + 2] = (t.data[q + 2] as number) * shade;
          u = 0;
        } else {
          const g = 90 * shade;
          o[k] = g; o[k + 1] = g; o[k + 2] = g;
        }
        o[k + 3] = 255;
      }
    }
    if (step === 1) this.ctx.putImageData(out, 0, 0);
    else {
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      (tmp.getContext("2d") as CanvasRenderingContext2D).putImageData(out, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(tmp, 0, 0, W, H);
    }
    this.drawGraticule();
    this.drawMarkers();
    $("mmView").textContent = `centre ${Math.abs(this.lat0).toFixed(1)}°${this.lat0 < 0 ? "S" : "N"} ${(((this.lon0 % 360) + 360) % 360).toFixed(1)}°E · zoom ×${this.zoom.toFixed(this.zoom < 10 ? 1 : 0)}`;
  }

  private drawGraticule(): void {
    const c = this.ctx;
    c.strokeStyle = "rgba(255,255,255,0.08)";
    c.lineWidth = 1;
    const lats = this.zoom > 12 ? [-89, -88, -87, -86, -85, -80] : [-80, -60, -30, 0, 30, 60, 80];
    for (const la of lats) {
      c.beginPath();
      let pen = false;
      for (let lo = -180; lo <= 180; lo += 2) {
        const p = this.project(lo, la);
        if (!p) { pen = false; continue; }
        if (pen) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
        pen = true;
      }
      c.stroke();
    }
    for (let lo = -180; lo < 180; lo += 30) {
      c.beginPath();
      let pen = false;
      for (let la = -90; la <= 90; la += 2) {
        const p = this.project(lo, la);
        if (!p) { pen = false; continue; }
        if (pen) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
        pen = true;
      }
      c.stroke();
    }
  }

  private drawMarkers(): void {
    const c = this.ctx;
    const items = [...this.opts.items(), ...(this.custom ? [this.custom] : [])].filter((it) => this.filters.has(it.cat));
    const order: MapCat[] = ["you", "craft", "objective", "base", "historic", "site", "discovery", "custom"];
    items.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
    const clusters: { x: number; y: number; items: MapItem[] }[] = [];
    for (const it of items) {
      const p = this.project(it.lon, it.lat);
      if (!p) continue;
      const cl = clusters.find((k) => Math.hypot(k.x - p.x, k.y - p.y) < 18);
      if (cl) cl.items.push(it);
      else clusters.push({ x: p.x, y: p.y, items: [it] });
    }
    this.hits = clusters;
    c.font = "600 12px system-ui, sans-serif";
    for (const cl of clusters) {
      const it = cl.items[0] as MapItem;
      if (cl.items.length > 1) {
        const hasYou = cl.items.some((i) => i.cat === "you");
        c.fillStyle = "rgba(12,14,16,0.85)";
        c.strokeStyle = hasYou ? CAT.you.color : "#ffb347";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cl.x, cl.y, 13, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = "#f2efe8";
        c.textAlign = "center";
        c.fillText(String(cl.items.length), cl.x, cl.y + 4);
        c.textAlign = "left";
        const names = cl.items.slice(0, 2).map((i) => i.name.split(" (")[0]).join(", ") + (cl.items.length > 2 ? "…" : "");
        this.labelAt(cl.x + 17, cl.y + 4, names, "rgba(242,239,232,0.75)");
        continue;
      }
      this.glyph(cl.x, cl.y, it.cat, this.sel?.id === it.id);
      this.labelAt(cl.x + 11, cl.y + 4, it.name.split(" (")[0] as string, it.cat === "you" ? CAT.you.color : "#f2efe8");
    }
  }

  private labelAt(x: number, y: number, t: string, col: string): void {
    const c = this.ctx;
    c.lineWidth = 3;
    c.strokeStyle = "rgba(0,0,0,0.75)";
    c.strokeText(t, x, y);
    c.fillStyle = col;
    c.fillText(t, x, y);
  }

  private glyph(x: number, y: number, cat: MapCat, sel: boolean): void {
    const c = this.ctx;
    const col = CAT[cat].color;
    c.fillStyle = col;
    c.strokeStyle = "rgba(0,0,0,0.8)";
    c.lineWidth = 1.5;
    c.beginPath();
    switch (CAT[cat].shape) {
      case "sq": c.rect(x - 5, y - 5, 10, 10); break;
      case "di": c.moveTo(x, y - 7); c.lineTo(x + 6, y); c.lineTo(x, y + 7); c.lineTo(x - 6, y); c.closePath(); break;
      case "ci": c.arc(x, y, 5, 0, Math.PI * 2); break;
      case "ring": c.arc(x, y, 7, 0, Math.PI * 2); c.lineWidth = 3; c.strokeStyle = col; c.stroke(); c.beginPath(); break;
      case "star": for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 3 : 7; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); break;
      case "plus": c.rect(x - 1.5, y - 7, 3, 14); c.rect(x - 7, y - 1.5, 14, 3); break;
      case "you": c.arc(x, y, 6, 0, Math.PI * 2); break;
      case "tri": c.moveTo(x, y - 7); c.lineTo(x + 6, y + 5); c.lineTo(x - 6, y + 5); c.closePath(); break;
    }
    c.fill();
    c.stroke();
    if (sel) {
      c.strokeStyle = "#7fe0a0";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, 12, 0, Math.PI * 2);
      c.stroke();
    }
  }

  private click(e: PointerEvent): void {
    const r = this.cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * this.cv.width;
    const py = ((e.clientY - r.top) / r.height) * this.cv.height;
    const hit = this.hits.find((h) => Math.hypot(h.x - px, h.y - py) < 14);
    if (hit && hit.items.length > 1) {
      const it = hit.items[0] as MapItem;
      this.lon0 = it.lon;
      this.lat0 = it.lat;
      this.setZoom(Math.max(this.zoom * 4, 20));
      return;
    }
    if (hit) { this.select(hit.items[0] as MapItem); return; }
    const ll = this.unproject(px, py);
    if (!ll) return;
    this.custom = { id: "custom", name: `Custom point`, lon: ll.lon, lat: ll.lat, cat: "custom", desc: "A point you picked. Terrain there: NASA LOLA 400 m grid near the south pole, otherwise a smooth sphere (no local relief) — the landing preview says which." };
    this.select(this.custom);
  }

  private renderSide(): void {
    const it = this.sel;
    $("mmInfo").innerHTML = this.opts.info?.() ?? "";
    const box = $("mmSel");
    if (!it) {
      box.innerHTML = `<p class="dim small">Drag to rotate · scroll to zoom · click a marker (or a cluster to zoom in) · click empty ground for a custom point.</p>`;
      return;
    }
    const fmt = (la: number, lo: number): string => `${Math.abs(la).toFixed(4)}°${la < 0 ? "S" : "N"} · ${(((lo % 360) + 360) % 360).toFixed(4)}°E`;
    box.innerHTML = `<div class="eyebrow" style="color:${CAT[it.cat].color}">${CAT[it.cat].label}</div><h3>${it.name}</h3>
      <div class="mono dim small">${fmt(it.lat, it.lon)}</div>
      ${it.status ? `<div class="mm-status">${it.status}</div>` : ""}
      ${it.desc ? `<p class="small">${it.desc}</p>` : ""}
      ${it.meta ? `<p class="dim small">${it.meta}</p>` : ""}
      <div class="mm-acts"></div>`;
    const acts = box.querySelector(".mm-acts") as HTMLElement;
    for (const a of this.opts.actions(it)) {
      const b = document.createElement("button");
      b.className = `pill small${a.primary ? " primary" : ""}`;
      b.textContent = a.label;
      b.disabled = !!a.disabled;
      b.addEventListener("click", () => a.fn());
      acts.appendChild(b);
    }
  }
}
