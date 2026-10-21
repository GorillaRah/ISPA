import json, time, requests
from pathlib import Path
from datetime import datetime, timezone

BBOX = "-6.345,106.594,-6.122,107.018"          # S,W,N,E (Overpass order)
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",   # fallback mirror
]
MIN_FEATURES = 313      # ~70% of the 447 hospitals in the latest OSM snapshot

QUERY = f"""
[out:json][timeout:120];
(
  nwr["amenity"="hospital"]({BBOX});
  nwr["healthcare"="hospital"]({BBOX});
);
out center meta;
"""

def fetch():
    last = None
    for url in ENDPOINTS:
        for attempt in range(2):
            try:
                r = requests.post(url, data={"data": QUERY}, timeout=180,
                                  headers={"User-Agent": "WebGIS-ISPA-Jakarta/1.0 (student project)"})
                r.raise_for_status()
                return r.json()["elements"]
            except Exception as e:
                last = e
                print(f"{url} attempt {attempt + 1} failed: {e}")
                time.sleep(10)
    raise RuntimeError(f"All Overpass endpoints failed: {last}")

elements = fetch()
features, seen = [], set()
for el in elements:
    tags = el.get("tags", {})
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        continue
    name = tags.get("name") or tags.get("name:id") or tags.get("operator") or "Fasilitas kesehatan (tanpa nama)"
    key = (name.lower().strip(), round(lat, 3), round(lon, 3))      # node + building polygon of the same place
    if key in seen:
        continue
    seen.add(key)
    features.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "name": name,
            "amenity": tags.get("amenity"),
            "healthcare": tags.get("healthcare"),
            "osm_id": el["id"],
            "osm_type": el["type"],
            "changeset_timestamp": el.get("timestamp"),
            "source_osm": True,
        },
    })

if len(features) < MIN_FEATURES:
    raise SystemExit(f"Only {len(features)} features, refusing to overwrite data")

fc = {
    "type": "FeatureCollection",
    "name": "FasilitasKesehatan_OSM",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "features": features,
}
out = Path(__file__).resolve().parent / "data" / "FasilitasKesehatan_OSM.js"
out.write_text("var json_FasilitasKesehatan_OSM = " + json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + ";",
               encoding="utf-8")

hosp = sum(1 for f in features if "hospital" in ((f["properties"]["amenity"] or "") + (f["properties"]["healthcare"] or "")))
print(f"{len(features)} hospitals ({hosp} tagged hospital) -> {out} ({out.stat().st_size // 1024} KB)")