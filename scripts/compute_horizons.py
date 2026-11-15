"""Terrain skylines from NASA LRO/LOLA elevation models.

For each curated site, trace 720 great-circle rays (every 0.5 deg of azimuth) out
to 260 km and keep the highest elevation angle the terrain reaches. That angle,
per direction, is the real horizon: the Sun or Earth is only visible above it.

DATA (NASA Goddard PGDA product 90, Barker et al. 2023, south polar stereographic,
1737.4 km sphere, heights in metres relative to that sphere):
  near field   0-12 km   LDEM_80S_20MPP_ADJ  (20 m/px, read as a small window over HTTP)
  mid field   12-150 km  LDEM_80S_80MPP_ADJ  (80 m/px, covers 80-90 S)
  far field  150-260 km  LDEM_60S_240MPP_ADJ (240 m/px, covers 60-90 S)
A sample that falls outside a finer grid falls back to the next coarser one, so a
site near 80 S still gets a complete skyline. 260 km is past the distance at
which the tallest polar relief (~14 km) can still rise above a level horizon
(sqrt(2 * R * 14 km) ~ 220 km).

GEOMETRY (exact, not the small-angle approximation): observer at radius
R + h0 + eye, terrain sample at radius R + h at central angle delta = d / R:
    elevation = atan2((R + h) cos(delta) - (R + h0 + eye), (R + h) sin(delta))

Outputs public/data/horizons/<id>.json (720 angles + obstruction distance +
coverage flags), public/data/terrain/south_pole_400m.{bin,json} for the in-browser
skyline of arbitrary points, and public/data/terrain/south_pole_hillshade.png.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import Window
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data_raw"
OUT_H = ROOT / "public" / "data" / "horizons"
OUT_T = ROOT / "public" / "data" / "terrain"
R = 1_737_400.0
EYE_M = 2.0
N_AZ = 720

GEO = "+proj=longlat +R=1737400 +no_defs"
STERE = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
TO_XY = Transformer.from_crs(GEO, STERE, always_xy=True)

URL_20 = "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"

SITES = json.loads((ROOT / "public" / "data" / "sites.json").read_text())["sites"]


class Grid:
    """A DEM held in memory with bilinear sampling at projected coordinates."""

    def __init__(self, name: str, data: np.ndarray, x0: float, y0: float, px: float):
        self.name, self.data, self.x0, self.y0, self.px = name, data.astype(np.float32), x0, y0, px

    def sample(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        col = (x - self.x0) / self.px - 0.5
        row = (self.y0 - y) / self.px - 0.5
        h, w = self.data.shape
        inside = (col >= 0) & (col <= w - 1) & (row >= 0) & (row <= h - 1)
        out = np.full(x.shape, np.nan, dtype=np.float64)
        if inside.any():
            out[inside] = map_coordinates(self.data, [row[inside], col[inside]], order=1, mode="nearest")
        return out


def open_grid(path: Path, name: str) -> Grid:
    with rasterio.open(path) as ds:
        t = ds.transform
        return Grid(name, ds.read(1), t.c, t.f, t.a)


def near_grid(site_id: str, x: float, y: float, half_m: float = 12_500) -> Grid | None:
    """20 m window around the site, fetched once by HTTP range requests and cached."""
    cache = RAW / f"near20_{site_id}.npz"
    if cache.exists():
        z = np.load(cache)
        return Grid("LDEM_80S_20MPP_ADJ", z["data"], float(z["x0"]), float(z["y0"]), 20.0)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF"):
        with rasterio.open(URL_20) as ds:
            t = ds.transform
            c0 = int((x - half_m - t.c) / t.a)
            r0 = int((t.f - (y + half_m)) / -t.e)
            n = int(2 * half_m / t.a)
            if c0 < 0 or r0 < 0 or c0 + n > ds.width or r0 + n > ds.height:
                return None
            data = ds.read(1, window=Window(c0, r0, n, n))
            x0 = t.c + c0 * t.a
            y0 = t.f + r0 * t.e
    np.savez_compressed(cache, data=data, x0=x0, y0=y0)
    return Grid("LDEM_80S_20MPP_ADJ", data, x0, y0, 20.0)


def destination(lon: float, lat: float, az: np.ndarray, d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Great-circle destination on the sphere; az from north, eastward (rad); d in metres."""
    phi1, lam1 = np.radians(lat), np.radians(lon)
    delta = d / R
    sin_phi2 = np.sin(phi1) * np.cos(delta) + np.cos(phi1) * np.sin(delta) * np.cos(az)
    phi2 = np.arcsin(np.clip(sin_phi2, -1, 1))
    lam2 = lam1 + np.arctan2(np.sin(az) * np.sin(delta) * np.cos(phi1), np.cos(delta) - np.sin(phi1) * sin_phi2)
    return np.degrees(lam2), np.degrees(phi2)


def skyline(lon: float, lat: float, levels: list[tuple[Grid, float, float, float]], h0: float, eye: float = EYE_M):
    """levels: (grid, d_start, d_stop, step). Returns horizon deg, obstruction km, coverage km per azimuth."""
    az = np.radians(np.arange(N_AZ) * (360.0 / N_AZ))
    dists = np.concatenate([np.arange(a, b, s) for _, a, b, s in levels])
    which = np.concatenate([np.full(len(np.arange(a, b, s)), i) for i, (_, a, b, s) in enumerate(levels)])
    AZ, D = np.meshgrid(az, dists, indexing="ij")
    lons, lats = destination(lon, lat, AZ.ravel(), D.ravel())
    xs, ys = TO_XY.transform(lons, lats)
    xs = np.asarray(xs).reshape(AZ.shape)
    ys = np.asarray(ys).reshape(AZ.shape)
    H = np.full(AZ.shape, np.nan)
    # Finest grid first for its own distance band, then fall back to coarser grids.
    for i, (grid, _, _, _) in enumerate(levels):
        band = which == i
        H[:, band] = grid.sample(xs[:, band], ys[:, band])
    for grid, _, _, _ in reversed(levels):
        miss = np.isnan(H)
        if miss.any():
            H[miss] = grid.sample(xs[miss], ys[miss])
    delta = D / R
    ro = R + h0 + eye
    rt = R + H
    el = np.degrees(np.arctan2(rt * np.cos(delta) - ro, rt * np.sin(delta)))
    el_masked = np.where(np.isnan(el), -90.0, el)
    k = np.argmax(el_masked, axis=1)
    horizon = el_masked[np.arange(N_AZ), k]
    obstruction_km = dists[k] / 1000.0
    valid = ~np.isnan(H)
    coverage_km = np.where(valid.any(axis=1), dists[np.where(valid, np.arange(len(dists)), 0).max(axis=1)] / 1000.0, 0.0)
    return horizon, obstruction_km, coverage_km


def main() -> None:
    OUT_H.mkdir(parents=True, exist_ok=True)
    OUT_T.mkdir(parents=True, exist_ok=True)
    g80 = open_grid(RAW / "LDEM_80S_80MPP_ADJ.TIF", "LDEM_80S_80MPP_ADJ")
    g240 = open_grid(RAW / "LDEM_60S_240MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ")
    print("grids loaded", g80.data.shape, g240.data.shape)

    only = set(sys.argv[1:])
    for site in SITES:
        if only and site["id"] not in only:
            continue
        lon, lat = site["lon"], site["lat"]
        x, y = TO_XY.transform(lon, lat)
        near = near_grid(site["id"], x, y) if lat <= -80 else None
        levels: list[tuple[Grid, float, float, float]] = []
        if near is not None:
            levels.append((near, 20.0, 12_000.0, 20.0))
            levels.append((g80, 12_000.0, 150_000.0, 80.0))
        else:
            levels.append((g80, 80.0, 150_000.0, 80.0))
        levels.append((g240, 150_000.0, 260_000.0, 240.0))
        if not (-90 <= lat <= -80):
            levels = [(g240, 240.0, 260_000.0, 240.0)]  # outside the 80 m map: 240 m only
        h0_src = levels[0][0]
        h0 = float(h0_src.sample(np.array([x]), np.array([y]))[0])
        if np.isnan(h0):
            print(f"{site['id']}: no elevation at site, skipped")
            continue
        horizon, obst, cov = skyline(lon, lat, levels, h0)
        # The same site on the browser's 400 m grid, so the app's in-browser
        # skyline can be compared with this one (Reality Check, resolution effect).
        out = {
            "id": site["id"],
            "name": site["name"],
            "lon": lon,
            "lat": lat,
            "ground_m": round(h0, 1),
            "eye_m": EYE_M,
            "az_step_deg": 360.0 / N_AZ,
            "horizon_deg": [round(float(v), 3) for v in horizon],
            "obstruction_km": [round(float(v), 2) for v in obst],
            "coverage_km_min": round(float(cov.min()), 1),
            "dems": [f"{g.name} {a/1000:.0f}-{b/1000:.0f} km @ {s:.0f} m" for g, a, b, s in levels],
            "method": "720 great-circle rays, exact curvature, max elevation angle per azimuth; bilinear DEM sampling",
            "computed_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        (OUT_H / f"{site['id']}.json").write_text(json.dumps(out, separators=(",", ":")))
        print(f"{site['id']}: ground {h0:.0f} m, horizon {horizon.min():.2f}..{horizon.max():.2f} deg, "
              f"coverage >= {cov.min():.0f} km, dems {[g.name for g, *_ in levels]}")

    # Browser grid: 80 m -> 400 m block mean, int16 metres.
    f = 5
    h, w = g80.data.shape
    coarse = g80.data[: h - h % f, : w - w % f].reshape(h // f, f, w // f, f).mean(axis=(1, 3))
    grid16 = np.round(np.nan_to_num(coarse, nan=-32768)).astype("<i2")
    (OUT_T / "south_pole_400m.bin").write_bytes(grid16.tobytes())
    meta = {
        "source": "Downsampled (5x5 block mean) from NASA Goddard LDEM_80S_80MPP_ADJ (Barker et al. 2023, PGDA product 90)",
        "crs": STERE,
        "width": int(grid16.shape[1]),
        "height": int(grid16.shape[0]),
        "x0": g80.x0,
        "y0": g80.y0,
        "px_m": g80.px * f,
        "dtype": "int16 little-endian, metres above the 1737.4 km sphere, -32768 = no data",
    }
    (OUT_T / "south_pole_400m.json").write_text(json.dumps(meta, indent=1))
    print("browser grid", grid16.shape, f"{(OUT_T / 'south_pole_400m.bin').stat().st_size / 1e6:.1f} MB")

    # Hillshade picture for the 2D site map (sun from the upper left, as maps do).
    gy, gx = np.gradient(coarse, 400.0)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    alt, azm = np.radians(35), np.radians(315)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(azm - aspect)
    img = np.clip(shade * 255, 0, 255).astype(np.uint8)
    with rasterio.open(OUT_T / "south_pole_hillshade.png", "w", driver="PNG", width=img.shape[1],
                       height=img.shape[0], count=1, dtype="uint8") as dst:
        dst.write(img, 1)
    print("hillshade written")


if __name__ == "__main__":
    main()
