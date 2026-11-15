"""Independent check data: Horizons' OWN topocentric Sun/Earth azimuth-elevation
for observers standing on the Moon.

The app never uses these numbers to draw anything. tests/sky.test.ts recomputes
every one of them from the sub-point table (scripts/fetch_horizons.py) and the
Reality Check panel shows the measured disagreement.

Times are all at :30 — exactly half-way between the hourly table samples — so the
test also measures the worst case of the app's interpolation.

Run:  .venv-data/bin/python scripts/fetch_fixtures.py
Writes public/data/validation/horizons_topocentric.json
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "validation" / "horizons_topocentric.json"

# (label, east longitude deg, latitude deg). Sources for the coordinates are in
# public/data/sites.json; these are test points, so near-pole, equator and the
# far side (where Earth is always below the horizon) are all represented.
SITES = [
    ("Near south pole (0 E, 89.5 S)", 0.0, -89.5),
    ("IM-1 Odysseus landing site", 1.44, -80.13),
    ("IM-2 Athena target", 29.13, -84.78),
    ("Apollo 11 landing site", 23.47297, 0.67408),
    ("Far side, Von Karman crater", 177.6, -45.44),
]
WINDOWS = [
    ("2024-02-22 00:30", "2024-03-23 00:30"),
    ("2028-01-05 00:30", "2028-02-04 00:30"),
]
BODIES = [("sun", "10"), ("earth", "399")]


def query(body: str, lon: float, lat: float, start: str, stop: str) -> list[dict]:
    params = {
        "format": "json",
        "COMMAND": f"'{body}'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},0'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": "'73h'",
        "QUANTITIES": "'4'",
        "CSV_FORMAT": "'YES'",
        "OBJ_DATA": "'NO'",
        "ANG_FORMAT": "'DEG'",
    }
    r = requests.get(API, params=params, timeout=120)
    r.raise_for_status()
    text = r.json()["result"]
    if "$$SOE" not in text:
        raise RuntimeError(text[:800])
    body_text = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    out = []
    for line in body_text.strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        when = datetime.strptime(cells[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        az, el = float(cells[3]), float(cells[4])
        out.append({"t": int(when.timestamp()), "az": az, "el": el})
    return out


def main() -> None:
    cases = []
    for label, lon, lat in SITES:
        for start, stop in WINDOWS:
            for name, code in BODIES:
                for row in query(code, lon, lat, start, stop):
                    cases.append({"site": label, "lon": lon, "lat": lat, "body": name, **row})
                time.sleep(0.6)
        print(f"{label}: done")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "NASA/JPL Horizons API, OBSERVER table, CENTER='coord@301' (observer on the Moon), QUANTITIES='4'",
        "note": "Apparent azimuth (deg from north, eastward) and elevation (deg). Airless body: no refraction.",
        "retrieved_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cases": cases,
    }, indent=0))
    print(f"wrote {OUT}: {len(cases)} cases")


if __name__ == "__main__":
    main()
