// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The two pictures the whole app is built around.
 *  - Panorama: the 360° skyline from LOLA terrain, with every Sun and Earth position
 *    in the window plotted against it. Solid where it clears the skyline, hollow
 *    where the smooth Moon says "visible" but terrain blocks it — the "one degree".
 *  - Strip: the same visibility as a timeline (Sun / Earth / both), with a playhead.
 * Both read straight from an Analysis, so they cannot disagree with the metrics.
 */

import type { Analysis } from "../data";
import { horizonAt } from "../science/terrain";
import { fmtDate } from "./format";

const C = {
  bg0: "#030304",
  bg1: "#0b0b0d",
  grid: "rgba(236,230,218,0.07)",
  gridLabel: "rgba(236,230,218,0.45)",
  ground0: "#34312b",
  ground1: "#121110",
  ridge: "#b9b2a5",
  smooth: "rgba(236,230,218,0.55)",
  sun: "#f2b544",
  sunDim: "rgba(242,181,68,0.9)",
  earth: "#6fa8dc",
  both: "#4fb6a8",
  blocked: "#ff8a5c",
  text: "#ece6da",
};

function setup(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 360;
  const cssH = Number(canvas.getAttribute("height")) || 160;
  canvas.style.height = `${cssH}px`;
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  const wantH = Math.round(cssH * dpr);
  if (canvas.height !== wantH) {
    canvas.height = wantH;
    canvas.setAttribute("height", String(cssH));
  }
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

export interface PanoOptions {
  mode: "real" | "smooth";
  now: number; // sample index
  compact?: boolean;
}

export function drawPanorama(canvas: HTMLCanvasElement, a: Analysis, o: PanoOptions): void {
  const { ctx, w, h } = setup(canvas);
  const sky = a.skyline;
  const tr = a.track;
  const vis = o.mode === "real" ? a.real : a.smooth;
  let minEl = Math.min(-1.5, a.smoothDeg - 1);
  let maxEl = 5;
  if (sky) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of sky.horizon) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    minEl = Math.min(minEl, lo - 0.6);
    maxEl = Math.max(maxEl, hi + 1.2);
  }
  let sunHi = -90;
  let earthHi = -90;
  for (let i = 0; i < tr.n; i++) {
    sunHi = Math.max(sunHi, tr.sunEl[i] as number);
    earthHi = Math.max(earthHi, tr.earthEl[i] as number);
  }
  maxEl = Math.min(90, Math.max(maxEl, sunHi + 1.2, Math.min(earthHi + 1.2, 90)));
  const padL = 30;
  const padB = 16;
  const padT = 6;
  const pw = w - padL - 4;
  const ph = h - padB - padT;
  const X = (az: number): number => padL + ((((az % 360) + 360) % 360) / 360) * pw;
  const Y = (el: number): number => padT + (1 - (el - minEl) / (maxEl - minEl)) * ph;

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.bg0);
  g.addColorStop(1, C.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Elevation grid
  const span = maxEl - minEl;
  const step = span > 60 ? 15 : span > 30 ? 10 : span > 14 ? 5 : span > 7 ? 2 : 1;
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.textBaseline = "middle";
  for (let e = Math.ceil(minEl / step) * step; e <= maxEl; e += step) {
    const y = Y(e);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - 4, y);
    ctx.stroke();
    ctx.fillStyle = C.gridLabel;
    ctx.fillText(`${e}°`, 2, y);
  }
  // Azimuth labels
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  for (const [az, name] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"], [360, "N"]] as [number, string][]) {
    const x = az === 360 ? padL + pw : X(az);
    ctx.fillStyle = C.gridLabel;
    ctx.fillText(name, Math.min(Math.max(x, padL + 6), w - 8), h - 3);
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + ph);
    ctx.stroke();
  }
  ctx.textAlign = "left";

  // Terrain silhouette
  if (sky) {
    const gg = ctx.createLinearGradient(0, Y(maxEl), 0, padT + ph);
    gg.addColorStop(0, C.ground0);
    gg.addColorStop(1, C.ground1);
    ctx.beginPath();
    ctx.moveTo(padL, padT + ph);
    const n = 720;
    for (let k = 0; k <= n; k++) {
      const az = (k / n) * 360;
      ctx.lineTo(padL + (k / n) * pw, Y(horizonAt(sky.horizon, az)));
    }
    ctx.lineTo(padL + pw, padT + ph);
    ctx.closePath();
    ctx.globalAlpha = o.mode === "real" ? 1 : 0.28;
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.mode === "real" ? C.ridge : "rgba(185,178,165,0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const az = (k / n) * 360;
      const x = padL + (k / n) * pw;
      const y = Y(horizonAt(sky.horizon, az));
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = "#1a1917";
    ctx.fillRect(padL, Y(a.smoothDeg), pw, padT + ph - Y(a.smoothDeg));
  }
  // Smooth-Moon horizon
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = C.smooth;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Y(a.smoothDeg));
  ctx.lineTo(padL + pw, Y(a.smoothDeg));
  ctx.stroke();
  ctx.setLineDash([]);

  // Paths
  const dotR = o.compact ? 1.4 : 1.8;
  const plot = (azArr: Float32Array, elArr: Float32Array, upArr: Uint8Array, smoothUp: Uint8Array, color: string): void => {
    for (let i = 0; i < tr.n; i += o.compact ? 2 : 1) {
      const e = elArr[i] as number;
      if (Number.isNaN(e) || e < minEl || e > maxEl) continue;
      const x = X(azArr[i] as number);
      const y = Y(e);
      if (upArr[i]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else if (smoothUp[i] && o.mode === "real") {
        ctx.strokeStyle = C.blocked;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, dotR + 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };
  const sunSmoothUp = a.smooth.sunLit;
  plot(tr.earthAz, tr.earthEl, vis.earthUp, a.smooth.earthUp, C.earth);
  plot(tr.sunAz, tr.sunEl, vis.sunLit, sunSmoothUp, C.sunDim);

  // Now markers
  const i = Math.max(0, Math.min(tr.n - 1, o.now));
  const glyph = (az: number, e: number, color: string, label: string, r: number): void => {
    if (Number.isNaN(e) || e < minEl - 2 || e > maxEl + 2) return;
    const x = X(az);
    const y = Math.max(padT + 4, Math.min(padT + ph - 2, Y(e)));
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    rg.addColorStop(0, color);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = "600 10.5px Inter, sans-serif";
    ctx.fillStyle = C.text;
    ctx.fillText(label, Math.min(x + r + 4, w - 40), y - r - 2);
  };
  glyph(tr.earthAz[i] as number, tr.earthEl[i] as number, C.earth, "Earth", o.compact ? 4.5 : 5.5);
  glyph(tr.sunAz[i] as number, tr.sunEl[i] as number, C.sun, "Sun", o.compact ? 5 : 6.5);

  // Scale note
  const exag = (ph / (maxEl - minEl)) / (pw / 360);
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = C.gridLabel;
  ctx.textAlign = "right";
  ctx.fillText(`vertical ×${exag >= 10 ? exag.toFixed(0) : exag.toFixed(1)} · dashed = smooth Moon`, w - 6, padT + 10);
  ctx.textAlign = "left";
  if (!sky) {
    ctx.fillStyle = "#e2a94b";
    ctx.fillText("Geometric estimate only — terrain not verified here", padL + 6, padT + 10);
  }
}

export function drawStrip(canvas: HTMLCanvasElement, a: Analysis, o: { mode: "real" | "smooth"; now: number }): void {
  const { ctx, w, h } = setup(canvas);
  const vis = o.mode === "real" ? a.real : a.smooth;
  const n = vis.n;
  const padL = 46;
  const padR = 6;
  const pw = w - padL - padR;
  const rows = [
    { label: "Sun", color: C.sun },
    { label: "Earth", color: C.earth },
    { label: "Both", color: C.both },
  ];
  const showGhost = o.mode === "real" && a.skyline !== null;
  const rowH = (h - 16 - (showGhost ? 10 : 0)) / rows.length;
  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "600 10.5px Inter, sans-serif";
  ctx.textBaseline = "middle";
  rows.forEach((r, k) => {
    const y0 = 2 + k * rowH;
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.fillRect(padL, y0 + 1, pw, rowH - 3);
    ctx.fillStyle = r.color;
    ctx.fillText(r.label, 4, y0 + rowH / 2);
    for (let i = 0; i < n; i++) {
      let on = 0;
      if (k === 0) on = vis.sunFrac[i] as number;
      else if (k === 1) on = vis.earthUp[i] as number;
      else on = (vis.sunLit[i] as number) & (vis.earthUp[i] as number);
      if (on <= 0.01) continue;
      const x = padL + (i / n) * pw;
      ctx.globalAlpha = k === 0 ? 0.25 + 0.75 * on : 1;
      ctx.fillStyle = r.color;
      ctx.fillRect(x, y0 + 1, Math.max(1, pw / n + 0.6), rowH - 3);
    }
    ctx.globalAlpha = 1;
  });
  if (showGhost) {
    const y0 = 2 + rows.length * rowH;
    ctx.font = "9.5px Inter, sans-serif";
    ctx.fillStyle = C.gridLabel;
    ctx.fillText("smooth", 4, y0 + 4);
    for (let i = 0; i < n; i++) {
      if (!a.smooth.sunLit[i]) continue;
      const x = padL + (i / n) * pw;
      ctx.fillStyle = a.real.sunLit[i] ? "rgba(242,181,68,0.35)" : C.blocked;
      ctx.fillRect(x, y0 + 1, Math.max(1, pw / n + 0.6), 6);
    }
  }
  // Day ticks
  const days = (n - 1) * (vis.stepS / 86400);
  ctx.font = "9.5px JetBrains Mono, monospace";
  ctx.textBaseline = "alphabetic";
  const every = days > 20 ? 5 : days > 8 ? 2 : 1;
  for (let d = 0; d <= days; d++) {
    const x = padL + (d / days) * pw;
    ctx.fillStyle = "rgba(236,230,218,0.12)";
    ctx.fillRect(x, 2, 1, h - 16);
    if (d % every === 0 && d < days) {
      ctx.fillStyle = C.gridLabel;
      ctx.fillText(fmtDate(vis.t0 + d * 86400).replace(/ \d{4}$/, ""), x + 2, h - 3);
    }
  }
  // Playhead
  const px = padL + (Math.max(0, Math.min(n - 1, o.now)) / n) * pw;
  ctx.fillStyle = C.text;
  ctx.fillRect(px - 1, 0, 2, h - 14);
}

export function stripIndexFromEvent(canvas: HTMLCanvasElement, ev: MouseEvent | PointerEvent, n: number): number {
  const r = canvas.getBoundingClientRect();
  const padL = 46;
  const pw = r.width - padL - 6;
  const f = (ev.clientX - r.left - padL) / pw;
  return Math.max(0, Math.min(n - 1, Math.round(f * n)));
}
