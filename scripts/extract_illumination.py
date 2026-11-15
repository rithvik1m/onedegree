# AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
"""NASA's own long-term Sun and Earth visibility at each site — an independent check.

Mazarico et al. (NASA Goddard PGDA product 69, 2016 release): hourly illumination
averaged over 18.6 years (a lunar nutation cycle), 120 m/px, 75-90 S, polar
stereographic, 1737.4 km sphere. Earth counts as visible if ANY part of its disc is.
These are long averages from a different DEM and period, so the app compares them
with its own multi-year averages qualitatively, with the differences stated.

Writes public/data/validation/nasa_illumination_at_sites.json
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data_raw"
OUT = ROOT / "public" / "data" / "validation" / "nasa_illumination_at_sites.json"
GEO = "+proj=longlat +R=1737400 +no_defs"

sites = json.loads((ROOT / "public" / "data" / "sites.json").read_text())["sites"]


def values(path: Path) -> dict[str, dict]:
    out = {}
    with rasterio.open(path) as ds:
        to_xy = Transformer.from_crs(GEO, ds.crs.to_proj4(), always_xy=True)
        a = ds.read(1)
        nod = ds.nodata
        for s in sites:
            x, y = to_xy.transform(s["lon"], s["lat"])
            r, c = ds.index(x, y)
            if not (0 <= r < ds.height and 0 <= c < ds.width):
                out[s["id"]] = {"value": None, "note": "outside map"}
                continue
            v = float(a[r, c])
            win = a[max(r - 1, 0): r + 2, max(c - 1, 0): c + 2].astype(float)
            if nod is not None:
                win = win[win != nod]
            out[s["id"]] = {"value": v, "neighbourhood_min": float(np.min(win)), "neighbourhood_max": float(np.max(win))}
        meta = {"crs": ds.crs.to_proj4(), "res_m": ds.res[0], "dtype": str(a.dtype), "nodata": nod,
                "global_min": float(np.nanmin(a)), "global_max": float(np.nanmax(a))}
    return {"meta": meta, "sites": out}


sun = values(RAW / "AVGVISIB_75S_120M_201608.TIF")
earth = values(RAW / "AVGVISIB_75S_120M_201608_EARTH.TIF")
OUT.write_text(json.dumps({
    "source": "NASA Goddard PGDA product 69 (Mazarico et al.), AVGVISIB_75S_120M_201608 and _EARTH: hourly visibility averaged over 18.6 years, 120 m/px",
    "url": "https://pgda.gsfc.nasa.gov/products/69",
    "rules": "Sun: fraction of the solar disc visible, averaged. Earth: visible if any part of its disc is above the terrain.",
    "sun": sun,
    "earth": earth,
}, indent=1))
print(json.dumps({"sun": sun, "earth": earth}, indent=1))
