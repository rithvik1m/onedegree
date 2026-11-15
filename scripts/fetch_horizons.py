"""Fetch the one NASA/JPL Horizons table the whole sky engine runs on.

WHAT IS FETCHED
---------------
The Moon (COMMAND 301) observed from Earth's centre (CENTER 500@399), hourly, with
three quantities:
  14  observer sub-longitude / sub-latitude  -> where Earth is overhead on the Moon
  15  solar sub-longitude / sub-latitude     -> where the Sun is overhead on the Moon
  20  observer range (delta, AU)             -> Earth-Moon distance

Those two sub-points are directions in the Moon's body-fixed frame, so for ANY
surface point the Sun's and Earth's azimuth / elevation follow from vector maths
(src/science/sky.ts). tests/sky.test.ts checks that maths against Horizons' own
topocentric answers (scripts/fetch_fixtures.py) — nothing here is trusted untested.

Run:  .venv-data/bin/python scripts/fetch_horizons.py
Writes public/data/ephemeris/moon_subpoints_hourly.json
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "ephemeris" / "moon_subpoints_hourly.json"

START = datetime(2023, 8, 1, tzinfo=timezone.utc)
STOP = datetime(2029, 1, 1, tzinfo=timezone.utc)
AU_KM = 149_597_870.7

# Half-year chunks keep each response well inside Horizons' output limits.
CHUNKS = [
    ("2023-08-01", "2024-01-01"), ("2024-01-01", "2024-07-01"),
    ("2024-07-01", "2025-01-01"), ("2025-01-01", "2025-07-01"),
    ("2025-07-01", "2026-01-01"), ("2026-01-01", "2026-07-01"),
    ("2026-07-01", "2027-01-01"), ("2027-01-01", "2027-07-01"),
    ("2027-07-01", "2028-01-01"), ("2028-01-01", "2028-07-01"),
    ("2028-07-01", "2029-01-01"),
]

PARAMS = {
    "format": "json",
    "COMMAND": "'301'",
    "EPHEM_TYPE": "'OBSERVER'",
    "CENTER": "'500@399'",
    "STEP_SIZE": "'1h'",
    "QUANTITIES": "'14,15,20'",
    "CSV_FORMAT": "'YES'",
    "OBJ_DATA": "'NO'",
    "MAKE_EPHEM": "'YES'",
    "ANG_FORMAT": "'DEG'",
}


def fetch_chunk(start: str, stop: str) -> list[tuple[datetime, float, float, float, float, float]]:
    params = dict(PARAMS, START_TIME=f"'{start} 00:00'", STOP_TIME=f"'{stop} 00:00'")
    for attempt in range(4):
        try:
            r = requests.get(API, params=params, timeout=120)
            r.raise_for_status()
            text = r.json()["result"]
            break
        except Exception as exc:  # network hiccup: back off and retry, never invent
            if attempt == 3:
                raise
            print(f"  retry {start}: {exc}")
            time.sleep(5 * (attempt + 1))
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons returned no ephemeris for {start}..{stop}:\n{text[:800]}")
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for line in body.strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        # Date, solar-presence flag, lunar-presence flag, ObsLon, ObsLat, SunLon, SunLat, delta, deldot
        when = datetime.strptime(cells[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        nums = [float(c) for c in cells[3:8]]
        rows.append((when, *nums))  # type: ignore[arg-type]
    return rows


def main() -> None:
    all_rows: list[tuple] = []
    for start, stop in CHUNKS:
        rows = fetch_chunk(start, stop)
        if all_rows and rows and rows[0][0] == all_rows[-1][0]:
            rows = rows[1:]  # chunk boundaries overlap by one sample
        all_rows.extend(rows)
        print(f"{start}..{stop}: {len(rows)} rows")
        time.sleep(1.0)  # be gentle with a public service

    t0 = all_rows[0][0]
    for i, row in enumerate(all_rows):  # the table must be gap-free and hourly
        expected = t0.timestamp() + 3600 * i
        if abs(row[0].timestamp() - expected) > 0.5:
            raise RuntimeError(f"gap or misorder at row {i}: {row[0]}")

    out = {
        "source": "NASA/JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api)",
        "query": {k: v for k, v in PARAMS.items() if k != "format"} | {
            "START_TIME": START.strftime("%Y-%m-%d %H:%M"),
            "STOP_TIME": STOP.strftime("%Y-%m-%d %H:%M"),
            "chunked": "half-year requests, joined and checked gap-free",
        },
        "meaning": {
            "obsLon/obsLat": "apparent sub-Earth point on the Moon (deg, east longitude, planetodetic)",
            "sunLon/sunLat": "apparent sub-solar point on the Moon (deg, east longitude, planetodetic)",
            "distKm": "Earth-centre to Moon-centre distance (km)",
            "time": "UTC; sample i is at start_unix + i * step_s",
        },
        "retrieved_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_unix": int(t0.timestamp()),
        "step_s": 3600,
        "n": len(all_rows),
        "obsLon": [round(r[1], 4) for r in all_rows],
        "obsLat": [round(r[2], 4) for r in all_rows],
        "sunLon": [round(r[3], 4) for r in all_rows],
        "sunLat": [round(r[4], 4) for r in all_rows],
        "distKm": [round(r[5] * AU_KM) for r in all_rows],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB, {len(all_rows)} hourly rows)")


if __name__ == "__main__":
    main()
