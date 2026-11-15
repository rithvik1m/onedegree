# AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
"""2D planner map of 80-90 S: LOLA shaded relief + NASA's long-term sunlight map.

Both images share the browser terrain grid's frame (south polar stereographic,
x/y = +/-304 km), so the app converts a click to lat/lon with the same formula it
uses everywhere (src/science/terrain.ts fromPolarXY).
  - relief:   hillshade of LDEM_80S_80MPP_ADJ (NASA Goddard, Barker et al. 2023)
  - sunlight: AVGVISIB_75S_120M_201608 (NASA Goddard, Mazarico et al.), 18.6-yr
              average solar visibility, DN * 0.00004, cropped to the same box
"""
from pathlib import Path
import json
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data_raw"
OUT = ROOT / "public" / "data" / "terrain"
N = 1024
HALF = 304_000.0
dst_tr = from_bounds(-HALF, -HALF, HALF, HALF, N, N)

with rasterio.open(RAW / "LDEM_80S_80MPP_ADJ.TIF") as ds:
    z = ds.read(1, out_shape=(1900, 1900), resampling=Resampling.average).astype(np.float32)
    crs = ds.crs
px = 2 * HALF / 1900
gy, gx = np.gradient(z, px)
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gx, gy)
alt, az = np.radians(35), np.radians(315)
shade = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
relief = np.zeros((N, N), np.float32)
reproject(shade.astype(np.float32), relief, src_transform=from_bounds(-HALF, -HALF, HALF, HALF, 1900, 1900), src_crs=crs, dst_transform=dst_tr, dst_crs=crs, resampling=Resampling.bilinear)
gray = (25 + 200 * relief).astype(np.uint8)
with rasterio.open(OUT / "polar_relief.png", "w", driver="PNG", width=N, height=N, count=1, dtype="uint8") as o:
    o.write(gray, 1)

with rasterio.open(RAW / "AVGVISIB_75S_120M_201608.TIF") as ds:
    sun = np.zeros((N, N), np.float32)
    reproject(rasterio.band(ds, 1), sun, dst_transform=dst_tr, dst_crs=ds.crs, resampling=Resampling.average, dst_nodata=0)
frac = np.clip(sun * 0.00004, 0, 1)
# Amber only where the ground is genuinely well lit (ramp 15 % -> 55 % of the time);
# faint blue where NASA's map shows (near-)permanent shadow, the cold traps.
rgba = np.zeros((4, N, N), np.uint8)
lit = np.clip((frac - 0.15) / 0.40, 0, 1)
shadow = frac < 0.005
rgba[0] = np.where(shadow, 70, 242)
rgba[1] = np.where(shadow, 120, 181)
rgba[2] = np.where(shadow, 220, 68)
rgba[3] = np.where(shadow, 120, (lit * 215)).astype(np.uint8)
with rasterio.open(OUT / "polar_sunlight.png", "w", driver="PNG", width=N, height=N, count=4, dtype="uint8") as o:
    o.write(rgba)
(OUT / "polar_map.json").write_text(json.dumps({
    "size": N, "half_m": HALF,
    "relief": "Hillshade of NASA Goddard LDEM_80S_80MPP_ADJ (Barker et al. 2023)",
    "sunlight": "NASA Goddard AVGVISIB_75S_120M_201608 (Mazarico et al.), 18.6-year average solar visibility; amber ramps from 15% to 55% lit; blue = under 0.5% (near-permanent shadow), after averaging to ~594 m/px",
    "max_fraction": float(frac.max()),
}, indent=1))
print("ok", float(frac.max()), (OUT / "polar_relief.png").stat().st_size, (OUT / "polar_sunlight.png").stat().st_size)
