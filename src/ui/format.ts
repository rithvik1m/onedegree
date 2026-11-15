export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? "S" : "N"}`;
}

export function fmtLon(lon: number): string {
  const l = ((lon % 360) + 360) % 360;
  return `${l.toFixed(3)}°E`;
}

export function fmtUtc(unix: number, withTime = true): string {
  const d = new Date(unix * 1000);
  const date = d.toISOString().slice(0, 10);
  return withTime ? `${date} ${d.toISOString().slice(11, 16)}` : date;
}

export function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtHours(h: number, open = false): string {
  const pre = open ? "≥ " : "";
  if (h >= 48) return `${pre}${(h / 24).toFixed(1)} d`;
  return `${pre}${h.toFixed(h < 10 ? 1 : 0)} h`;
}

export function fmtDeg(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}°`;
}

export function pct(v: number): string {
  return `${v.toFixed(v >= 99.5 || v < 0.5 ? 0 : 0)}%`;
}

export function compass(az: number): string {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16] as string;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
