# AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
"""Site the (fictional) research outpost from NASA data, and build walkable terrain.

1. SITE SELECTION (data-driven, reproducible)
   Within 25 km of the south pole, on ground flatter than 8 deg (LOLA 80 m slope),
   pick the point with the highest long-term sunlight in NASA's 18.6-year average
   illumination map (PGDA product 69, AVGVISIB_75S_120M, DN x 0.00004), keeping only
   points where Earth is above the horizon at least 30 % of the time
   (AVGVISIB_..._EARTH). That is where a solar-powered outpost would want to be.
   The "shadow point" for Mission 03 is the nearby (300-1500 m) flat-ish spot whose
   long-term sunlight is lowest while still above 10 % (i.e. not permanently dark).

2. SKYLINES for both points: same method as scripts/compute_horizons.py
   (720 great-circle rays, exact curvature), near field from the 10 m LOLA DEM
   (LDEM_83S_10MPP_ADJ, PGDA product 90) instead of 20 m.

3. POLAR TERRAIN MESH per site for the 3D surface scene: 720 azimuths x rings
   (0-2 km every 10 m, then growing 1.15 % per ring to 220 km). Heights come from
   the finest DEM covering each sample (10 m -> 20 m -> 80 m -> 240 m). The browser
   builds the exact same great-circle geometry, so the 3D horizon is the LOLA horizon.

Outputs: public/data/surface/<id>.bin + <id>.json, public/data/horizons/<id>.json,
and the two new sites appended to public/data/sites.json (kind "outpost"/"survey").
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_horizons import (  # noqa: E402
    EYE_M, N_AZ, R, RAW, TO_XY, Grid, destination, open_grid, skyline,
)
from pyproj import Transformer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_S = ROOT / "public" / "data" / "surface"
OUT_H = ROOT / "public" / "data" / "horizons"
SITES_JSON = ROOT / "public" / "data" / "sites.json"
STERE = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
TO_LL = Transformer.from_crs(STERE, "+proj=longlat +R=1737400 +no_defs", always_xy=True)
URL_10 = "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF"
URL_20 = "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"
VIS_SCALE = 0.00004  # PDS label: DN x 0.00004 = fraction of time visible


def remote_window(url: str, px: float, x: float, y: float, half_m: float, tag: str) -> Grid | None:
    cache = RAW / f"win{int(px)}_{tag}.npz"
    if cache.exists():
        z = np.load(cache)
        return Grid(f"{Path(url).stem}", z["data"], float(z["x0"]), float(z["y0"]), px)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(url) as ds:
            t = ds.transform
            c0 = int((x - half_m - t.c) / t.a)
            r0 = int((t.f - (y + half_m)) / -t.e)
            n = int(2 * half_m / t.a)
            if c0 < 0 or r0 < 0 or c0 + n > ds.width or r0 + n > ds.height:
                return None
            data = ds.read(1, window=Window(c0, r0, n, n))
            x0, y0 = t.c + c0 * t.a, t.f + r0 * t.e
    data = np.where(data < -1e4, np.nan, data).astype(np.float32)
    np.savez_compressed(cache, data=data, x0=x0, y0=y0)
    return Grid(Path(url).stem, data, x0, y0, px)


def read_vis(path: Path, half_m: float) -> tuple[np.ndarray, float, float]:
    with rasterio.open(path) as ds:
        t = ds.transform
        c0 = int((-half_m - t.c) / t.a)
        r0 = int((t.f - half_m) / -t.e)
        n = int(2 * half_m / t.a)
        d = ds.read(1, window=Window(c0, r0, n, n)).astype(np.float32) * VIS_SCALE
        return d, t.c + c0 * t.a, t.f + r0 * t.e


def pick_sites(g80: Grid) -> tuple[dict, dict]:
    sun, x0, y0 = read_vis(RAW / "AVGVISIB_75S_120M_201608.TIF", 26_000)
    earth, _, _ = read_vis(RAW / "AVGVISIB_75S_120M_201608_EARTH.TIF", 26_000)
    n = sun.shape[0]
    xs = x0 + (np.arange(n) + 0.5) * 120.0
    ys = y0 - (np.arange(n) + 0.5) * 120.0
    X, Y = np.meshgrid(xs, ys)
    # slope from the 80 m DEM, sampled at the 120 m centres (gradient over +-120 m)
    def h(xx, yy):
        return g80.sample(xx, yy)
    gx = (h(X + 120, Y) - h(X - 120, Y)) / 240
    gy = (h(X, Y + 120) - h(X, Y - 120)) / 240
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    dist = np.hypot(X, Y)
    ok = (dist < 25_000) & (slope < 8) & (earth >= 0.30) & np.isfinite(slope)
    score = np.where(ok, sun, -1)
    order = np.argsort(score.ravel())[::-1][:8]
    print("top outpost candidates (sun, earth, slope, km from pole):")
    for k in order:
        i, j = divmod(int(k), n)
        lon, lat = TO_LL.transform(X[i, j], Y[i, j])
        print(f"  {lat:.4f} {lon:.3f}  sun {sun[i, j]:.3f} earth {earth[i, j]:.3f} slope {slope[i, j]:.1f}  {dist[i, j]/1000:.1f} km")
    i, j = divmod(int(order[0]), n)
    bx, by = X[i, j], Y[i, j]
    blon, blat = TO_LL.transform(bx, by)
    base = {"x": bx, "y": by, "lon": float(blon), "lat": float(blat), "sun": float(sun[i, j]),
            "earth": float(earth[i, j]), "slope": float(slope[i, j])}
    d = np.hypot(X - bx, Y - by)
    near = (d > 300) & (d < 1500) & (slope < 12) & (sun > 0.10) & np.isfinite(slope)
    s2 = np.where(near, -sun, -9)
    k = int(np.argmax(s2))
    i, j = divmod(k, n)
    slon, slat = TO_LL.transform(X[i, j], Y[i, j])
    shadow = {"x": X[i, j], "y": Y[i, j], "lon": float(slon), "lat": float(slat), "sun": float(sun[i, j]),
              "earth": float(earth[i, j]), "slope": float(slope[i, j]), "dist_m": float(d[i, j])}
    print("outpost:", base)
    print("shadow point:", shadow)
    return base, shadow


def ring_radii() -> np.ndarray:
    r = list(np.arange(0.0, 2000.0 + 1e-6, 10.0))
    while r[-1] < 220_000:
        r.append(r[-1] * 1.0115)
    return np.array(r)


def sample_levels(grids: list[Grid], xs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    H = np.full(xs.shape, np.nan)
    src = np.full(xs.shape, -1, dtype=np.int8)
    for gi, g in enumerate(grids):
        miss = np.isnan(H)
        if not miss.any():
            break
        v = g.sample(xs[miss], ys[miss])
        H[miss] = v
        s = src[miss]
        s[~np.isnan(v)] = gi
        src[miss] = s
    return H, src


def polar_mesh(sid: str, lon: float, lat: float, grids: list[Grid]) -> dict:
    radii = ring_radii()
    az = np.radians(np.arange(N_AZ) * (360.0 / N_AZ))
    AZ, D = np.meshgrid(az, radii, indexing="xy")  # rows = rings, cols = azimuths
    lons, lats = destination(lon, lat, AZ.ravel(), D.ravel())
    xs, ys = TO_XY.transform(lons, lats)
    H, src = sample_levels(grids, np.asarray(xs), np.asarray(ys))
    H = H.reshape(D.shape)
    src = src.reshape(D.shape)
    if np.isnan(H).any():
        # fill tiny holes from neighbours along the ring
        H = np.where(np.isnan(H), np.nanmean(H, axis=1, keepdims=True), H)
    h0 = float(H[0, 0])
    rel = (H - h0).astype(np.float32)
    nr = len(radii)
    n_near = int(np.searchsorted(radii, 2000.0 + 1e-6))
    near = rel[:n_near].astype("<f4")
    far = np.clip(np.round(rel[n_near:]), -32767, 32767).astype("<i2")
    OUT_S.mkdir(parents=True, exist_ok=True)
    (OUT_S / f"{sid}.bin").write_bytes(near.tobytes() + far.tobytes())
    meta = {
        "id": sid, "lon": lon, "lat": lat, "ground_m": round(h0, 2), "n_az": N_AZ,
        "radii_m": [round(float(r), 2) for r in radii], "n_rings": nr, "n_near": n_near,
        "layout": "rows = rings (radius), cols = azimuth (deg = col * 0.5, clockwise from north); "
                  "first n_near rows float32 metres, remaining rows int16 metres; all relative to ground_m",
        "dems": [g.name for g in grids],
        "source_share": {grids[i].name: round(float((src == i).mean()), 4) for i in range(len(grids))},
        "finest_to_m": {grids[i].name: round(float(radii[(src == i).any(axis=1)].max()), 0) if (src == i).any() else 0
                        for i in range(len(grids))},
        "computed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (OUT_S / f"{sid}.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"mesh {sid}: {nr} rings x {N_AZ}, ground {h0:.1f} m, relief {np.nanmin(rel[:n_near]):.0f}..{np.nanmax(rel[:n_near]):.0f} m within 2 km, "
          f"{(OUT_S / f'{sid}.bin').stat().st_size/1e6:.2f} MB, finest {meta['finest_to_m']}")
    return meta


def write_skyline(sid: str, name: str, lon: float, lat: float, grids: list[Grid], g80: Grid, g240: Grid, near_px: float) -> None:
    near = grids[0]
    levels = [(near, near_px, 2_400.0, near_px)]
    if len(grids) > 1 and grids[1].px == 20.0:
        levels.append((grids[1], 2_400.0, 12_000.0, 20.0))
    levels += [(g80, 12_000.0, 150_000.0, 80.0), (g240, 150_000.0, 260_000.0, 240.0)]
    x, y = TO_XY.transform(lon, lat)
    h0 = float(near.sample(np.array([x]), np.array([y]))[0])
    horizon, obst, cov = skyline(lon, lat, levels, h0)
    out = {
        "id": sid, "name": name, "lon": lon, "lat": lat, "ground_m": round(h0, 1), "eye_m": EYE_M,
        "az_step_deg": 360.0 / N_AZ,
        "horizon_deg": [round(float(v), 3) for v in horizon],
        "obstruction_km": [round(float(v), 2) for v in obst],
        "coverage_km_min": round(float(cov.min()), 1),
        "dems": [f"{g.name} {a/1000:.1f}-{b/1000:.0f} km @ {s:.0f} m" for g, a, b, s in levels],
        "method": "720 great-circle rays, exact curvature, max elevation angle per azimuth; bilinear DEM sampling",
        "computed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (OUT_H / f"{sid}.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"skyline {sid}: ground {h0:.1f} m, horizon {horizon.min():.2f}..{horizon.max():.2f} deg")


def main() -> None:
    g80 = open_grid(RAW / "LDEM_80S_80MPP_ADJ.TIF", "LDEM_80S_80MPP_ADJ")
    g240 = open_grid(RAW / "LDEM_60S_240MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ")
    base, shadow = pick_sites(g80)

    w10 = remote_window(URL_10, 10.0, base["x"], base["y"], 3_000, "base")
    w20 = remote_window(URL_20, 20.0, base["x"], base["y"], 12_500, "base")
    grids = [g for g in (w10, w20, g80, g240) if g is not None]
    # Snap both points' heights from the 10 m grid and write skylines.
    write_skyline("outpost", "Outpost (simulated) — ridge site", base["lon"], base["lat"], grids, g80, g240, 10.0)
    write_skyline("survey", "Survey point S-1 — Mission 03", shadow["lon"], shadow["lat"], grids, g80, g240, 10.0)
    polar_mesh("outpost", base["lon"], base["lat"], grids)

    sites = json.loads(SITES_JSON.read_text())
    others = [s for s in sites["sites"] if s["id"] not in ("outpost", "survey")]
    sites["sites"] = [
        {
            "id": "outpost", "name": "Outpost (simulated) — ridge site", "short": "Outpost",
            "lat": round(base["lat"], 5), "lon": round(base["lon"], 5), "kind": "outpost",
            "event": "A fictional research outpost. The location is real and was chosen by code: the flattest-enough point within 25 km of the pole with the most long-term sunlight in NASA's 18.6-year illumination map, where Earth is up at least 30 % of the time.",
            "source": f"scripts/outpost.py — NASA PGDA product 69 map: sun {base['sun']*100:.1f} %, Earth {base['earth']*100:.1f} % (120 m pixel); slope {base['slope']:.1f} deg (LOLA 80 m).",
        },
        {
            "id": "survey", "name": "Survey point S-1 — the shadow problem", "short": "Survey S-1",
            "lat": round(shadow["lat"], 5), "lon": round(shadow["lon"], 5), "kind": "survey",
            "event": f"{shadow['dist_m']:.0f} m from the outpost. Chosen by code as the nearby spot with the least long-term sunlight that is not permanently dark.",
            "source": f"scripts/outpost.py — NASA PGDA product 69 map: sun {shadow['sun']*100:.1f} %, Earth {shadow['earth']*100:.1f} %.",
        },
    ] + others
    SITES_JSON.write_text(json.dumps(sites, indent=2, ensure_ascii=False) + "\n")
    print("sites.json updated")

    # Polar meshes for the two lander sites the campaign lands at.
    for sid in ("im2", "im1"):
        s = next(x for x in others if x["id"] == sid)
        x, y = TO_XY.transform(s["lon"], s["lat"])
        w10s = remote_window(URL_10, 10.0, x, y, 3_000, sid) if s["lat"] <= -83.2 else None
        w20s = remote_window(URL_20, 20.0, x, y, 6_000, sid)
        polar_mesh(sid, s["lon"], s["lat"], [g for g in (w10s, w20s, g80, g240) if g is not None])


if __name__ == "__main__":
    main()
