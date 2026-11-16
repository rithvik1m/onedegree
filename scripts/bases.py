# AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
"""Site two more (fictional) research stations from NASA maps, like scripts/outpost.py.

SHADOW RESEARCH STATION — flat ground (slope < 6°, LOLA 80 m) within 60 km of the pole,
  ≥ 30 km from the outpost, with moderate long-term sunlight (25–45 %) and a near-
  permanently dark spot (< 2 %) within 0.4–1.5 km. Its partner point SH-2 is that dark spot.
EARTHLINK COMMUNICATIONS STATION — flat ground within 60 km of the pole, ≥ 25 km from both
  other stations, sunlight ≥ 40 %, maximising long-term EARTH visibility. Its partner point
  LS-1 (Lost Signal) is the nearby spot (0.3–1.5 km) with the least Earth visibility.
Maps: NASA PGDA product 69 (AVGVISIB_75S_120M, DN × 0.00004). Terrain: PGDA product 90
(10 m south of 83°S, 20 m, 80 m, 240 m). Writes the same files as outpost.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_horizons import RAW, open_grid  # noqa: E402
from outpost import TO_LL, URL_10, URL_20, polar_mesh, read_vis, remote_window, write_skyline  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITES_JSON = ROOT / "public" / "data" / "sites.json"


def main() -> None:
    g80 = open_grid(RAW / "LDEM_80S_80MPP_ADJ.TIF", "LDEM_80S_80MPP_ADJ")
    g240 = open_grid(RAW / "LDEM_60S_240MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ")
    half = 60_000
    sun, x0, y0 = read_vis(RAW / "AVGVISIB_75S_120M_201608.TIF", half)
    earth, _, _ = read_vis(RAW / "AVGVISIB_75S_120M_201608_EARTH.TIF", half)
    n = sun.shape[0]
    xs = x0 + (np.arange(n) + 0.5) * 120.0
    ys = y0 - (np.arange(n) + 0.5) * 120.0
    X, Y = np.meshgrid(xs, ys)
    gx = (g80.sample(X + 120, Y) - g80.sample(X - 120, Y)) / 240
    gy = (g80.sample(X, Y + 120) - g80.sample(X, Y - 120)) / 240
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    dist = np.hypot(X, Y)
    sites = json.loads(SITES_JSON.read_text())
    op = next(s for s in sites["sites"] if s["id"] == "outpost")
    from outpost import TO_XY  # noqa: E402
    ox, oy = TO_XY.transform(op["lon"], op["lat"])
    d_out = np.hypot(X - ox, Y - oy)
    # dark-neighbour map: min sunlight within 1.5 km (12 px) — via a coarse sliding minimum
    from scipy.ndimage import minimum_filter
    dark_near = minimum_filter(np.where(np.isfinite(slope) & (slope < 15), sun, 1.0), size=25)
    ok = (dist < 58_000) & (d_out > 30_000) & (slope < 6) & (sun > 0.25) & (sun < 0.45) & (dark_near < 0.02) & np.isfinite(slope)
    k = int(np.argmax(np.where(ok, sun - dark_near, -9)))
    i, j = divmod(k, n)
    sh = {"x": X[i, j], "y": Y[i, j], "sun": float(sun[i, j]), "earth": float(earth[i, j]), "slope": float(slope[i, j])}
    d = np.hypot(X - sh["x"], Y - sh["y"])
    near = (d > 400) & (d < 1500) & (slope < 15) & (sun < 0.02) & np.isfinite(slope)
    k2 = int(np.argmin(np.where(near, d, 1e9)))
    i2, j2 = divmod(k2, n)
    sh2 = {"x": X[i2, j2], "y": Y[i2, j2], "sun": float(sun[i2, j2]), "earth": float(earth[i2, j2]), "d": float(d[i2, j2])}
    d_sh = np.hypot(X - sh["x"], Y - sh["y"])
    ok2 = (dist < 58_000) & (d_out > 25_000) & (d_sh > 25_000) & (slope < 6) & (sun >= 0.4) & np.isfinite(slope)
    k3 = int(np.argmax(np.where(ok2, earth, -9)))
    i3, j3 = divmod(k3, n)
    el = {"x": X[i3, j3], "y": Y[i3, j3], "sun": float(sun[i3, j3]), "earth": float(earth[i3, j3]), "slope": float(slope[i3, j3])}
    d_el = np.hypot(X - el["x"], Y - el["y"])
    near2 = (d_el > 300) & (d_el < 1500) & (slope < 12) & np.isfinite(slope)
    k4 = int(np.argmin(np.where(near2, earth, 9)))
    i4, j4 = divmod(k4, n)
    ls = {"x": X[i4, j4], "y": Y[i4, j4], "sun": float(sun[i4, j4]), "earth": float(earth[i4, j4]), "d": float(d_el[i4, j4])}
    for name, p in [("shadow", sh), ("sh2", sh2), ("earthlink", el), ("ls1", ls)]:
        lon, lat = TO_LL.transform(p["x"], p["y"])
        p["lon"], p["lat"] = float(lon), float(lat)
        print(name, {k: (round(v, 4) if isinstance(v, float) else v) for k, v in p.items() if k not in ("x", "y")}, f"{np.hypot(p['x'], p['y'])/1000:.1f} km from pole")

    def build(sid: str, base: dict, partner: dict, partner_id: str) -> None:
        w10 = remote_window(URL_10, 10.0, base["x"], base["y"], 3_000, sid) if base["lat"] <= -83.2 else None
        w20 = remote_window(URL_20, 20.0, base["x"], base["y"], 12_500, sid)
        grids = [g for g in (w10, w20, g80, g240) if g is not None]
        near_px = grids[0].px
        write_skyline(sid, sid, base["lon"], base["lat"], grids, g80, g240, near_px)
        write_skyline(partner_id, partner_id, partner["lon"], partner["lat"], grids, g80, g240, near_px)
        polar_mesh(sid, base["lon"], base["lat"], grids)

    build("shadow", sh, sh2, "sh2")
    build("earthlink", el, ls, "ls1")
    keep = [s for s in sites["sites"] if s["id"] not in ("shadow", "sh2", "earthlink", "ls1")]
    new = [
        {"id": "shadow", "name": "Shadow Research Station (simulated)", "short": "Shadow Station", "lat": round(sh["lat"], 5), "lon": round(sh["lon"], 5), "kind": "base",
         "event": f"A fictional station on a real site chosen by code: flat ground with moderate long-term sunlight ({sh['sun']*100:.0f} %) right next to near-permanent shadow.",
         "source": f"scripts/bases.py — NASA PGDA 69 map: sun {sh['sun']*100:.1f} %, Earth {sh['earth']*100:.1f} %; slope {sh['slope']:.1f}° (LOLA 80 m)."},
        {"id": "sh2", "name": "SH-2 — shadow survey point", "short": "SH-2", "lat": round(sh2["lat"], 5), "lon": round(sh2["lon"], 5), "kind": "survey",
         "event": f"{sh2['d']:.0f} m from the Shadow Station; NASA's 18.6-year map shows it almost never sunlit.",
         "source": f"scripts/bases.py — NASA PGDA 69 map: sun {sh2['sun']*100:.1f} %, Earth {sh2['earth']*100:.1f} %."},
        {"id": "earthlink", "name": "EarthLink Communications Station (simulated)", "short": "EarthLink", "lat": round(el["lat"], 5), "lon": round(el["lon"], 5), "kind": "base",
         "event": f"A fictional communications station on a real site chosen by code for Earth visibility ({el['earth']*100:.0f} % long-term) with sunlight for power ({el['sun']*100:.0f} %).",
         "source": f"scripts/bases.py — NASA PGDA 69 maps: Earth {el['earth']*100:.1f} %, sun {el['sun']*100:.1f} %; slope {el['slope']:.1f}° (LOLA 80 m)."},
        {"id": "ls1", "name": "LS-1 — Lost Signal site", "short": "LS-1", "lat": round(ls["lat"], 5), "lon": round(ls["lon"], 5), "kind": "survey",
         "event": f"{ls['d']:.0f} m from EarthLink: the nearby spot with the least long-term Earth visibility ({ls['earth']*100:.0f} %).",
         "source": f"scripts/bases.py — NASA PGDA 69 map: Earth {ls['earth']*100:.1f} %, sun {ls['sun']*100:.1f} %."},
    ]
    sites["sites"] = keep[:2] + new + keep[2:]
    SITES_JSON.write_text(json.dumps(sites, indent=2, ensure_ascii=False) + "\n")
    print("sites.json updated")


if __name__ == "__main__":
    main()
