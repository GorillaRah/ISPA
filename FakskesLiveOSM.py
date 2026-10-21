import json, time, re, requests
from pathlib import Path

BBOX = "-6.345,106.594,-6.122,107.018"          # S,W,N,E (Overpass order)
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",   # fallback mirror
]
MIN_FEATURES = 1443     # ~70% of the 2,062 facilities from the first filtered run

QUERY = f"""
[out:json][timeout:120];
(
  nwr["amenity"~"^(hospital|clinic|doctors)$"]({BBOX});
  nwr["healthcare"~"^(hospital|clinic|doctor|centre)$"]({BBOX});
);
out center meta;
"""

# Not relevant to ISPA (respiratory infection): dental, eye, skin/beauty, veterinary, physio/spa
EXCLUDE_NAME = re.compile(
    r"\b(gigi|dental|dentist|rsgm|orthodont\w*|ortodont\w*|"
    r"mata|eye|optik|optical|kulit|derma\w*|kecantikan|beauty|aesthetic\w*|estetik\w*|skin|"
    r"hewan|veteriner\w*|vet|fisioterapi|physio\w*|pijat|massage|rehab\w*|akupunktur)\b",
    re.I)
EXCLUDE_SPECIALITY = re.compile(r"dent|ophthalm|dermat|aesthetic|physio|veterin", re.I)
EXCLUDE_SPA_NAME = re.compile(r"\bspa\b", re.I)

def is_relevant(tags, name):
    if tags.get("amenity") == "dentist" or tags.get("healthcare") == "dentist":
        return False
    # In Indonesian medical names, ", SpA" denotes a pediatrician, not a spa.
    if EXCLUDE_NAME.search(name) or (
            EXCLUDE_SPA_NAME.search(name) and not re.search(r",\s*SpA\b", name)):
        return False
    spec = " ".join(tags.get(k, "") for k in ("healthcare:speciality", "speciality"))
    return not EXCLUDE_SPECIALITY.search(spec)

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
excluded = []
features, seen = [], set()
for el in elements:
    tags = el.get("tags", {})
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        continue
    name = tags.get("name") or tags.get("name:id") or tags.get("operator") or "Fasilitas kesehatan (tanpa nama)"
    if not is_relevant(tags, name):
        excluded.append(name)
        continue
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

fc = {"type": "FeatureCollection", "name": "FasilitasKesehatan_OSM", "features": features}
out = Path(__file__).resolve().parent / "data" / "FasilitasKesehatan_OSM.js"
out.write_text("var json_FasilitasKesehatan_OSM = " + json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + ";",
               encoding="utf-8")

hosp = sum(1 for f in features if "hospital" in ((f["properties"]["amenity"] or "") + (f["properties"]["healthcare"] or "")))
print(f"{len(features)} facilities ({hosp} tagged hospital) -> {out} ({out.stat().st_size // 1024} KB)")
print(f"Excluded as not ISPA-relevant: {len(excluded)}")
for n in sorted(set(excluded))[:40]:
    print("  -", n)