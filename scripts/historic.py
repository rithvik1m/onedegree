# AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
"""Historic landing sites: walkable terrain + skyline from NASA LOLA's global 118 m DEM.

Coordinates: NASA NSSDC "Apollo Landing Sites" (Lunar Module positions),
https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html

Terrain: USGS Astrogeology mosaic of the LRO LOLA global DEM, 118 m/px
(Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif; int16, scale 0.5 m; simple cylindrical,
1737.4 km sphere), read as a ±WINDOW_KM window over HTTP range requests.
Beyond the window the mesh and the skyline use the smooth sphere — stated in the outputs.
Same ring layout and great-circle rays as scripts/outpost.py, so the browser code is shared.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_horizons import EYE_M, N_AZ, R, RAW, destination  # noqa: E402
from outpost import ring_radii  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_S = ROOT / "public" / "data" / "surface"
OUT_H = ROOT / "public" / "data" / "horizons"
URL = "/vsicurl/https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
WINDOW_KM = 25.0
SITES = {
    "a11": {"name": "Apollo 11 — Tranquility Base", "lat": 0.67416, "lon": 23.47314},
    "a15": {"name": "Apollo 15 — Hadley-Apennine", "lat": 26.13239, "lon": 3.63330},
    "a17": {"name": "Apollo 17 — Taurus-Littrow", "lat": 20.1911, "lon": 30.7723},
}


def window(lat: float, lon: float, tag: str) -> tuple[np.ndarray, float, float, float]:
    cache = RAW / f"ldem118_{tag}.npz"
    if cache.exists():
        z = np.load(cache)
        return z["h"], float(z["x0"]), float(z["y0"]), float(z["px"])
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(URL) as ds:
            t = ds.transform
            x = R * np.radians(lon)
            y = R * np.radians(lat)
            half = WINDOW_KM * 1000
            c0 = int((x - half - t.c) / t.a)
            r0 = int((t.f - (y + half)) / -t.e)
            n = int(2 * half / t.a)
            raw = ds.read(1, window=Window(c0, r0, n, n)).astype(np.float32)
            scale = ds.scales[0] if ds.scales else 1.0
            h = np.where(raw <= -32767, np.nan, raw * scale + (ds.offsets[0] if ds.offsets else 0.0))
            x0, y0 = t.c + c0 * t.a, t.f + r0 * t.e
    np.savez_compressed(cache, h=h, x0=x0, y0=y0, px=t.a)
    return h, x0, y0, t.a


def sample(h: np.ndarray, x0: float, y0: float, px: float, lons: np.ndarray, lats: np.ndarray) -> np.ndarray:
    x = R * np.radians(lons)
    y = R * np.radians(lats)
    col = (x - x0) / px - 0.5
    row = (y0 - y) / px - 0.5
    hh, ww = h.shape
    inside = (col >= 0) & (col <= ww - 1) & (row >= 0) & (row <= hh - 1)
    out = np.full(x.shape, np.nan)
    if inside.any():
        out[inside] = map_coordinates(np.nan_to_num(h, nan=float(np.nanmean(h))), [row[inside], col[inside]], order=1)
    return out


def main() -> None:
    for sid, s in SITES.items():
        h, x0, y0, px = window(s["lat"], s["lon"], sid)
        print(sid, "window", h.shape, f"{np.nanmin(h):.0f}..{np.nanmax(h):.0f} m")
        radii = ring_radii()
        az = np.radians(np.arange(N_AZ) * (360.0 / N_AZ))
        AZ, D = np.meshgrid(az, radii, indexing="xy")
        lons, lats = destination(s["lon"], s["lat"], AZ.ravel(), D.ravel())
        H = sample(h, x0, y0, px, lons, lats).reshape(D.shape)
        h0 = float(sample(h, x0, y0, px, np.array([s["lon"]]), np.array([s["lat"]]))[0])
        rel = np.where(np.isnan(H), 0.0, H - h0).astype(np.float32)  # beyond the window: smooth sphere
        n_near = int(np.searchsorted(radii, 2000.0 + 1e-6))
        far = np.clip(np.round(rel[n_near:]), -32767, 32767).astype("<i2")
        (OUT_S / f"{sid}.bin").write_bytes(rel[:n_near].astype("<f4").tobytes() + far.tobytes())
        covered = float(radii[(~np.isnan(H)).all(axis=1)].max())
        meta = {
            "id": sid, "lon": s["lon"], "lat": s["lat"], "ground_m": round(h0, 2), "n_az": N_AZ,
            "radii_m": [round(float(r), 2) for r in radii], "n_rings": len(radii), "n_near": n_near,
            "layout": "as outpost.json", "dems": ["LOLA global LDEM 118 m (USGS mosaic)"],
            "finest_to_m": {"LDEM_118M": round(covered)}, "beyond_window": "smooth sphere",
            "computed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        (OUT_S / f"{sid}.json").write_text(json.dumps(meta, separators=(",", ":")))
        # skyline with the exact formula, eye 2 m, rays to the window edge
        delta = D / R
        ro = R + h0 + EYE_M
        rt = R + np.where(np.isnan(H), h0 - 1e9, H)
        el = np.degrees(np.arctan2(rt * np.cos(delta) - ro, rt * np.sin(delta)))
        el[0] = -90
        smooth = -np.degrees(np.arccos(R / (R + EYE_M)))
        horizon = np.maximum(el.max(axis=0), smooth)
        k = el.argmax(axis=0)
        prof = {
            "id": sid, "name": s["name"], "lon": s["lon"], "lat": s["lat"], "ground_m": round(h0, 1), "eye_m": EYE_M,
            "az_step_deg": 360.0 / N_AZ, "horizon_deg": [round(float(v), 3) for v in horizon],
            "obstruction_km": [round(float(radii[i]) / 1000, 2) for i in k], "coverage_km_min": round(covered / 1000, 1),
            "dems": [f"LOLA global LDEM 118 m 0-{covered/1000:.0f} km (USGS mosaic); smooth sphere beyond"],
            "method": "720 great-circle rays, exact curvature, max elevation angle per azimuth; bilinear DEM sampling",
            "computed_utc": meta["computed_utc"],
        }
        (OUT_H / f"{sid}.json").write_text(json.dumps(prof, separators=(",", ":")))
        print(f"{sid}: ground {h0:.0f} m, relief within 2 km {rel[:n_near].min():.0f}..{rel[:n_near].max():.0f} m, horizon {horizon.min():.2f}..{horizon.max():.2f} deg, covered to {covered/1000:.1f} km")


if __name__ == "__main__":
    main()
