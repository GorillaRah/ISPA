"""
BUAT LAYER JS "INSIDEN ISPA /1.000" GAYA qgis2web

Menggabungkan data kasus (CSV) dengan poligon kelurahan dari file JS qgis2web
yang sudah ada, lalu menulis file JS baru berformat sama:

    var json_InsidenISPAKelurahan_0 = {"type":"FeatureCollection", ...};

Cara pakai (VS Code):
  1. pip install pandas numpy           (tidak perlu geopandas)
  2. Atur GEOM_JS (sumber poligon), CSV_PATH, dan OUT_JS di bagian konfigurasi.
  3. python buat_js_insiden_ispa.py
  4. Salin file hasil ke folder  data/  pada hasil ekspor qgis2web, lalu tambahkan
     <script src="data/InsidenISPAKelurahan_0.js"></script> di index.html
     (urutannya sebelum skrip yang memakai layer tersebut) dan buat style-nya.

Catatan:
  - File JS contoh memuat kolom-kolom bawaan SHP yang tidak diperlukan, termasuk
    path lokal komputer ("F:/MAGANGG WebGIS ..."). File hasil hanya membawa
    NAMOBJ, WADMKC, WADMKK dan kolom insiden, jadi path itu tidak ikut terbit.
  - Data kasus = pasien ISPA tahunan 2025 (bukan per kuartal).
"""
from __future__ import annotations

import difflib
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

# ============================================================
# KONFIGURASI
# ============================================================
try:
    HERE = Path(__file__).resolve().parent
except NameError:
    HERE = Path.cwd()

# File JS qgis2web yang berisi poligon kelurahan (dipakai sebagai sumber geometri).
GEOM_JS = HERE / "RisikoISPAKelurahanQ4_23_0.js"
CSV_PATH = HERE / "CSVdataPendudukISPA.csv"

# Nama layer -> nama variabel JS 'json_<NAMA>_0' dan nama file '<NAMA>_0.js'.
# Samakan dengan nama layer di QGIS/qgis2web (tanpa spasi).
LAYER_NAME = "InsidenISPAKelurahan"
OUT_JS = HERE / f"{LAYER_NAME}_0.js"

# Kolom nama di properti poligon (JS contoh memakai NAMOBJ).
KOL_NAMA = "NAMOBJ"
KOL_ADMIN = ["NAMOBJ", "WADMKC", "WADMKK"]   # properti poligon yang dibawa

# Koreksi nama manual (setelah normalisasi: huruf kecil, tanpa spasi/tanda baca).
# VERIFIKASI di peta: 'Utan Kayu Timur' di data batas = 'Utan Kayu Selatan' di CSV.
NAME_OVERRIDES = {"utankayutimur": "utankayuselatan"}
FUZZY_CUTOFF = 0.88

# Kelas insiden untuk memudahkan styling. None = kuantil (5 kelas, jumlah
# kelurahan per kelas relatif sama). Atau isi batas tetap, mis. [0.5, 1, 2, 4].
KELAS_BATAS = None
N_KELAS = 5

COORD_DECIMALS = 6   # 6 desimal ~ 0,1 m; memperkecil ukuran file
# ============================================================


def norm_nama(s) -> str:
    """Huruf kecil, tanpa spasi dan tanda baca ('Bale Kambang' == 'Balekambang')."""
    s = str(s).lower().strip()
    s = re.sub(r"^(kel\.?|kelurahan|desa)\s+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def baca_js_geojson(path: Path) -> dict:
    """Baca file 'var json_xxx = {...};' menjadi dict GeoJSON."""
    teks = Path(path).read_text(encoding="utf-8")
    awal, akhir = teks.find("{"), teks.rfind("}")
    if awal < 0 or akhir < 0:
        raise SystemExit(f"Isi {path} tidak terbaca sebagai JSON.")
    return json.loads(teks[awal:akhir + 1])


def bulatkan(koord, n=COORD_DECIMALS):
    if isinstance(koord, (int, float)):
        return round(koord, n)
    return [bulatkan(k, n) for k in koord]


def bersih(v):
    """NaN/inf -> None; numpy -> tipe Python (agar JSON valid)."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if (math.isnan(v) or math.isinf(v)) else float(v)
    return v


def pasangkan_nama(geom_keys, csv_keys):
    """Peta kunci geometri -> kunci CSV untuk nama yang tidak cocok persis."""
    mapping = {k: NAME_OVERRIDES[k] for k in geom_keys
               if k in NAME_OVERRIDES and NAME_OVERRIDES[k] in set(csv_keys)}
    sisa_csv = sorted(set(csv_keys) - set(geom_keys) - set(mapping.values()))
    dipakai = set()
    for k in sorted(set(geom_keys) - set(csv_keys) - set(mapping)):
        cand = [c for c in sisa_csv if c not in dipakai]
        m = difflib.get_close_matches(k, cand, n=1, cutoff=FUZZY_CUTOFF)
        if m:
            mapping[k] = m[0]
            dipakai.add(m[0])
    return mapping


def tentukan_kelas(nilai: pd.Series):
    v = nilai.dropna()
    if KELAS_BATAS is not None:
        batas = list(KELAS_BATAS)
    else:
        batas = list(np.quantile(v, np.linspace(0, 1, N_KELAS + 1))[1:-1])
    kelas = nilai.map(lambda x: None if pd.isna(x) else int(np.digitize(x, batas)) + 1)
    return kelas, batas


def main():
    gj = baca_js_geojson(GEOM_JS)
    fitur = gj["features"]
    print(f"Poligon: {len(fitur)} fitur dari {Path(GEOM_JS).name}")

    csv = pd.read_csv(CSV_PATH)
    wajib = ["kelurahan", "penduduk_total", "pasien_ispa_2025", "insiden_ispa_per1000"]
    hilang = [c for c in wajib if c not in csv.columns]
    if hilang:
        raise SystemExit(f"Kolom CSV tidak ditemukan: {hilang}")
    csv["key"] = csv["kelurahan"].map(norm_nama)
    if csv["key"].duplicated().any():
        print("PERINGATAN: nama ganda di CSV:", csv.loc[csv["key"].duplicated(keep=False), "kelurahan"].tolist())
    csv = csv.drop_duplicates("key").set_index("key")

    geom_keys = [norm_nama(f["properties"].get(KOL_NAMA)) for f in fitur]
    mapping = pasangkan_nama(geom_keys, csv.index)
    if mapping:
        print("Pencocokan nama non-persis (CEK MANUAL):")
        asli = {k: n for k, n in zip(geom_keys, (f["properties"].get(KOL_NAMA) for f in fitur))}
        for a, b in mapping.items():
            print(f"   poligon '{asli[a]}'  ->  CSV '{csv.loc[b, 'kelurahan']}'")

    # nilai insiden per fitur
    insiden = pd.Series(
        [csv["insiden_ispa_per1000"].get(mapping.get(k, k)) for k in geom_keys], dtype="float"
    )
    kelas, batas = tentukan_kelas(insiden)

    baru, tanpa_data = [], []
    for f, k, ins, kl in zip(fitur, geom_keys, insiden, kelas):
        kunci = mapping.get(k, k)
        props = {c: f["properties"].get(c) for c in KOL_ADMIN}
        if kunci in csv.index:
            r = csv.loc[kunci]
            props.update({
                "penduduk_total": bersih(int(r["penduduk_total"])),
                "pasien_ispa_2025": bersih(int(r["pasien_ispa_2025"])),
                "insiden_ispa_per1000": bersih(round(float(r["insiden_ispa_per1000"]), 2)),
                "kelas_insiden": bersih(kl),
            })
        else:
            tanpa_data.append(f["properties"].get(KOL_NAMA))
            props.update({"penduduk_total": None, "pasien_ispa_2025": None,
                          "insiden_ispa_per1000": None, "kelas_insiden": None})
        geom = dict(f["geometry"])
        geom["coordinates"] = bulatkan(geom["coordinates"])
        baru.append({"type": "Feature", "properties": props, "geometry": geom})

    out = {
        "type": "FeatureCollection",
        "name": f"{LAYER_NAME}_0",
        "crs": gj.get("crs", {"type": "name",
                              "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}),
        "features": baru,
    }
    teks = f"var json_{LAYER_NAME}_0 = " + json.dumps(out, separators=(",", ":"), ensure_ascii=True) + ";"
    Path(OUT_JS).write_text(teks, encoding="utf-8")

    # verifikasi: baca ulang file hasil
    cek = baca_js_geojson(OUT_JS)
    n_ok = sum(1 for f in cek["features"] if f["properties"]["insiden_ispa_per1000"] is not None)
    print(f"\nDitulis: {OUT_JS}  ({Path(OUT_JS).stat().st_size / 1e6:.2f} MB)")
    print(f"Variabel JS: json_{LAYER_NAME}_0 | fitur: {len(cek['features'])} | dengan data insiden: {n_ok}")
    if tanpa_data:
        print("Poligon TANPA data insiden (properti null):", tanpa_data)
    tepi = [float(insiden.min())] + [float(b) for b in batas] + [float(insiden.max())]
    print("\nKelas insiden untuk styling (kolom 'kelas_insiden'):")
    for i in range(len(tepi) - 1):
        print(f"   kelas {i + 1}: {tepi[i]:.2f} - {tepi[i + 1]:.2f} per 1.000")


if __name__ == "__main__":
    main()
