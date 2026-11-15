"""Shaded-relief texture of 80-90 S for the 3D fallback globe.

NASA Moon Trek's global LRO WAC tiles are equirectangular, so near the pole they are
smeared and useless at walking scale. This renders a hillshade of NASA Goddard's
LDEM_80S_80MPP_ADJ and reprojects it to lon/lat (-180..180, -90..-80) so Cesium can
drape it. It is a visual aid only (fixed illumination from the upper left); the
science never reads it.
"""
from pathlib import Path
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "data_raw" / "LDEM_80S_80MPP_ADJ.TIF"
out = ROOT / "public" / "data" / "terrain" / "south_pole_relief_geo.png"  # converted to .jpg (quality 82) with macOS sips; the PNG is not shipped
with rasterio.open(src) as ds:
    z = ds.read(1).astype(np.float32)
    crs, tr = ds.crs, ds.transform
gy, gx = np.gradient(z, 80.0)
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gx, gy)
alt, az = np.radians(30), np.radians(315)
shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
shade = np.clip(shade, 0, 1)
# Lunar-regolith tone: never pure black so the 3D ground stays readable.
img = (40 + 190 * shade).astype(np.uint8)
W, H = 8192, 1024
dst = np.zeros((H, W), dtype=np.uint8)
geo = "+proj=longlat +R=1737400 +no_defs"
reproject(img, dst, src_transform=tr, src_crs=crs, dst_transform=from_bounds(-180, -90, 180, -80, W, H), dst_crs=geo, resampling=Resampling.bilinear)
with rasterio.open(out, "w", driver="PNG", width=W, height=H, count=1, dtype="uint8") as o:
    o.write(dst, 1)
print(out, out.stat().st_size / 1e6, "MB")
