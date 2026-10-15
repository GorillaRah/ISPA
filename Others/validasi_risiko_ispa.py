"""
ANALISIS VARIABEL PERANCU: KEPADATAN PENDUDUK

Analisis ini berfokus pada hubungan kepadatan penduduk dengan skor indeks
risiko dan insiden ISPA, serta membandingkan korelasi indeks-insiden sebelum
dan sesudah kepadatan dikontrol.

Cara pakai (VS Code):
  1. pip install geopandas pandas numpy scipy
  2. Taruh CSVdataPendudukISPA.csv sejajar dengan file ini
     (atau ubah CSV_PATH di bawah), lalu cek SHP_PATHS.
  3. Jalankan:  python validasi_risiko_ispa.py
     Hasil (tabel CSV dan laporan TXT) ada di folder hasil_perancu_kepadatan/.

Catatan penting soal data:
  - CSV hanya punya kasus TAHUNAN 2025 (pasien_ispa_2025), bukan per kuartal.
  - Kasus yang tercatat di fasilitas kesehatan juga dipengaruhi akses dan
    pelaporan; korelasi wilayah bukan bukti sebab-akibat atau hubungan individu.
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

# ============================================================
# 0. KONFIGURASI — SESUAIKAN DI SINI
# ============================================================
try:
    HERE = Path(__file__).resolve().parent
except NameError:  # dijalankan di Interactive Window / notebook
    HERE = Path.cwd()

CSV_PATH = HERE / "CSVdataPendudukISPA.csv"

SHP_DIR = Path(
    r"C:\Users\Ardra\Downloads\WebGISKesehatan2web"
    r"\qgis2web_2026_09_17-15_43_47_334972\qgis2web_2026_09_17-15_43_47_334972"
    r"\Others\RisikoISPAKelurahan_26"
)
# Kuartal ditentukan dari KUNCI di sini (bukan dari angka di belakang nama file).
SHP_PATHS = {
    "Q1": SHP_DIR / "RisikoISPAKelurahanQ1_26.shp",
    "Q2": SHP_DIR / "RisikoISPAKelurahanQ2_25.shp",
    "Q3": SHP_DIR / "RisikoISPAKelurahanQ3_24.shp",
    "Q4": SHP_DIR / "RisikoISPAKelurahanQ4_23.shp",
}

OUT_DIR = HERE / "hasil_perancu_kepadatan"

# MODE BANDING VARIAN: isi dengan path risiko_semua_varian_per_kelurahan.csv
# (keluaran KalkulasiRisikoISPA_Varian.py) untuk membandingkan PC1, PC2, dan
# PC1PC2 sekaligus. Jika None, skrip membaca SHP_PATHS seperti biasa.
GABUNGAN_CSV = None   # contoh: HERE / "risiko_semua_varian_per_kelurahan.csv"

# Koreksi nama manual (kunci = nama SHP/tabel, nilai = nama di CSV kasus),
# setelah normalisasi: huruf kecil, tanpa spasi/tanda baca. VERIFIKASI di peta:
# keduanya berada di Kecamatan Matraman dan tidak ada pasangan lain.
NAME_OVERRIDES = {"utankayutimur": "utankayuselatan"}

# Nama kolom di SHP. Biarkan None agar dideteksi otomatis. Ingat: field SHP
# dibatasi 10 karakter, jadi 'risiko_ispa_normalisasi' bisa terpotong
# menjadi 'risiko_isp'. Daftar kolom tiap SHP selalu dicetak saat dijalankan.
SHP_NAMA_COL = None
SHP_KEC_COL = None
SHP_RISK_COL = None

NAME_CANDIDATES = ["kelurahan", "nama_kel", "namobj", "wadmkd", "nm_kel", "nama", "name", "kel", "desa"]
KEC_CANDIDATES = ["kecamatan", "wadmkc", "nama_kec", "nm_kec", "kec"]
RISK_CANDIDATES = [
    "risiko_ispa_normalisasi", "risiko_isp", "risiko_ispa", "risiko_mean",
    "risiko_mea", "risk", "skor", "score", "mean",
]

FUZZY_MATCH = True      # cocokkan nama yang mirip (typo/spasi); hasilnya dicetak untuk dicek
FUZZY_CUTOFF = 0.88
LOG: list[str] = []


def log(*args) -> None:
    text = " ".join(str(a) for a in args)
    print(text)
    LOG.append(text)


# ============================================================
# 1. FUNGSI BANTU
# ============================================================
def norm_nama(s) -> str:
    """Normalisasi nama untuk join: huruf kecil, tanpa spasi dan tanda baca."""
    s = str(s).lower().strip()
    s = re.sub(r"^(kel\.?|kelurahan|desa)\s+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)  # 'Bale Kambang' == 'Balekambang'


def cari_kolom(cols, kandidat):
    low = {c.lower(): c for c in cols}
    for k in kandidat:
        if k in low:
            return low[k]
    return None


def kekuatan(rho: float) -> str:
    if not np.isfinite(rho):
        return "tidak tersedia"
    a = abs(rho)
    return "dapat diabaikan" if a < 0.1 else "lemah" if a < 0.3 else "sedang" if a < 0.5 else "kuat"


def baca_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    wajib = ["kelurahan", "kecamatan", "kota_adm", "penduduk_total",
             "pasien_ispa_2025", "insiden_ispa_per1000"]
    hilang = [c for c in wajib if c not in df.columns]
    if hilang:
        raise SystemExit(f"Kolom CSV tidak ditemukan: {hilang}")
    df = df.rename(columns={"insiden_ispa_per1000": "insiden",
                            "risiko_ispa_normalisasi": "risk_csv"})
    df["key"] = df["kelurahan"].map(norm_nama)
    dup = df["key"].duplicated(keep=False)
    if dup.any():
        log("PERINGATAN: nama kelurahan ganda di CSV (join bisa keliru):",
            sorted(df.loc[dup, "kelurahan"].unique()))
    hitung = (df["pasien_ispa_2025"] / df["penduduk_total"] * 1000).round(2)
    selisih = int(((hitung - df["insiden"]).abs() > 0.02).sum())
    log(f"CSV: {len(df)} kelurahan; insiden tidak konsisten dengan pasien/penduduk: {selisih} baris")
    return df


def baca_shp(kuartal: str, path: Path):
    import geopandas as gpd  # diimpor di sini agar fungsi lain bisa diuji tanpa geopandas

    if not Path(path).exists():
        raise SystemExit(f"File tidak ditemukan: {path}")
    gdf = gpd.read_file(path)
    cols = [c for c in gdf.columns if c != "geometry"]
    log(f"\n[{kuartal}] {Path(path).name}: {len(gdf)} fitur, CRS={gdf.crs}")
    log(f"[{kuartal}] kolom: {cols}")

    nama = SHP_NAMA_COL or cari_kolom(cols, NAME_CANDIDATES)
    kec = SHP_KEC_COL or cari_kolom(cols, KEC_CANDIDATES)
    risk = SHP_RISK_COL or cari_kolom(cols, RISK_CANDIDATES)
    if risk is None:
        risk = next((c for c in cols if c.lower().startswith("risiko")), None)
    if nama is None or risk is None:
        raise SystemExit(
            f"[{kuartal}] Kolom nama/risiko tidak terdeteksi (nama={nama}, risiko={risk}). "
            "Isi SHP_NAMA_COL / SHP_RISK_COL di bagian konfigurasi."
        )
    log(f"[{kuartal}] memakai kolom nama='{nama}', kecamatan='{kec}', risiko='{risk}'")

    out = gpd.GeoDataFrame(
        {"nama": gdf[nama].astype(str),
         "risk": pd.to_numeric(gdf[risk], errors="coerce")},
        geometry=gdf.geometry, crs=gdf.crs,
    )
    out["key"] = out["nama"].map(norm_nama)
    n_nan = int(out["risk"].isna().sum())
    if n_nan:
        log(f"[{kuartal}] PERINGATAN: {n_nan} fitur tanpa nilai risiko (NaN)")
    if out["key"].duplicated().any():
        n = int(out["key"].duplicated().sum())
        log(f"[{kuartal}] {n} nama ganda/multipart digabung (risiko dirata-rata)")
        out = out.dissolve(by="key", aggfunc={"nama": "first", "risk": "mean"}).reset_index()
    return out


def peta_nama_fuzzy(shp_keys, csv_keys):
    """Pasangan nama SHP -> nama CSV untuk yang tidak cocok persis."""
    sisa_csv = sorted(set(csv_keys) - set(shp_keys))
    sisa_shp = sorted(set(shp_keys) - set(csv_keys))
    mapping, dipakai = {}, set()
    if FUZZY_MATCH:
        for k in sisa_shp:
            cand = [c for c in sisa_csv if c not in dipakai]
            m = difflib.get_close_matches(k, cand, n=1, cutoff=FUZZY_CUTOFF)
            if m:
                mapping[k] = m[0]
                dipakai.add(m[0])
    return mapping


def gabung_tabel(csv_df: pd.DataFrame, shps: dict) -> pd.DataFrame:
    tab = csv_df.copy()
    for q, g in shps.items():
        g = g.copy()
        g["key"] = g["key"].replace(NAME_OVERRIDES)
        mapping = peta_nama_fuzzy(g["key"], csv_df["key"])
        if mapping:
            log(f"[{q}] pencocokan nama mirip (cek manual):")
            for a, b in mapping.items():
                log(f"      SHP '{a}'  ->  CSV '{b}'")
            g["key"] = g["key"].replace(mapping)
        tak_cocok_shp = sorted(set(g["key"]) - set(csv_df["key"]))
        tak_cocok_csv = sorted(set(csv_df["key"]) - set(g["key"]))
        log(f"[{q}] cocok: {len(set(g['key']) & set(csv_df['key']))}/{len(csv_df)} kelurahan CSV; "
            f"SHP tanpa pasangan: {len(tak_cocok_shp)}; CSV tanpa pasangan: {len(tak_cocok_csv)}")
        if tak_cocok_shp:
            log(f"[{q}]   SHP tanpa pasangan: {tak_cocok_shp[:15]}{' ...' if len(tak_cocok_shp) > 15 else ''}")
        if tak_cocok_csv:
            log(f"[{q}]   CSV tanpa pasangan: {tak_cocok_csv[:15]}{' ...' if len(tak_cocok_csv) > 15 else ''}")
        tab = tab.merge(g[["key", "risk"]].rename(columns={"risk": f"risk_{q}"}),
                        on="key", how="left")
    qcols = [f"risk_{q}" for q in shps]
    tab["risk_mean4"] = tab[qcols].mean(axis=1, skipna=False)
    return tab


def luas_km2(gdf) -> pd.Series:
    """Luas tiap kelurahan (km2), dihitung di UTM 48S agar akurat."""
    g = gdf.to_crs(32748) if gdf.crs is not None and gdf.crs.is_geographic else gdf
    return pd.Series((g.geometry.area / 1e6).values, index=g["key"].values)


def muat_gabungan(csv_df: pd.DataFrame):
    """Mode banding varian: baca tabel gabungan dari KalkulasiRisikoISPA_Varian.py
    (kolom risk_<VARIAN>_Q1..Q4 + luas_km2) dan gabungkan dengan data kasus."""
    g = pd.read_csv(GABUNGAN_CSV)
    nama = SHP_NAMA_COL or cari_kolom(g.columns, NAME_CANDIDATES)
    if nama is None:
        raise SystemExit(f"Kolom nama tidak terdeteksi di {GABUNGAN_CSV}; isi SHP_NAMA_COL.")
    pola = re.compile(r"^risk_(.+)_(Q[1-4])$")
    kolom = [c for c in g.columns if pola.match(c)]
    if not kolom:
        raise SystemExit("Tidak ada kolom risk_<VARIAN>_Q<n> di tabel gabungan.")
    varian = sorted({pola.match(c).group(1) for c in kolom})
    log(f"\nMode banding varian: {GABUNGAN_CSV}\n  varian: {varian}; kolom nama: '{nama}'")

    g["key"] = g[nama].map(norm_nama).replace(NAME_OVERRIDES)
    mapping = peta_nama_fuzzy(g["key"], csv_df["key"])
    if mapping:
        log("  pencocokan nama mirip (cek manual):")
        for a, b in mapping.items():
            log(f"      tabel '{a}'  ->  CSV '{b}'")
        g["key"] = g["key"].replace(mapping)
    tak_shp = sorted(set(g["key"]) - set(csv_df["key"]))
    tak_csv = sorted(set(csv_df["key"]) - set(g["key"]))
    log(f"  cocok: {len(set(g['key']) & set(csv_df['key']))}/{len(csv_df)}; "
        f"tabel tanpa pasangan: {tak_shp}; CSV tanpa pasangan: {tak_csv}")

    ambil = ["key"] + kolom + (["luas_km2"] if "luas_km2" in g.columns else [])
    tab = csv_df.merge(g[ambil].drop_duplicates("key"), on="key", how="left")

    series = {}
    for v in varian:
        qc = [f"risk_{v}_{q}" for q in ("Q1", "Q2", "Q3", "Q4") if f"risk_{v}_{q}" in tab.columns]
        for c in qc:
            series[c] = f"{v} {c[-2:]}"
        tab[f"risk_{v}_mean4"] = tab[qc].mean(axis=1, skipna=False)
        series[f"risk_{v}_mean4"] = f"{v} rata-rata 4 kuartal"
    if "risk_csv" in tab.columns:
        series["risk_csv"] = "Kolom risiko di CSV"
    tab["kepadatan"] = (tab["penduduk_total"] / tab["luas_km2"]
                        if "luas_km2" in tab.columns else np.nan)
    return tab, series


# ============================================================
# 2. ANALISIS KEPADATAN SEBAGAI PERANCU
# ============================================================
def korelasi_spearman(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    valid = np.isfinite(x) & np.isfinite(y)
    x, y = x[valid], y[valid]
    if len(x) < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return np.nan, np.nan, len(x)
    rho, p = stats.spearmanr(x, y)
    return float(rho), float(p), len(x)


def spearman_parsial(x, y, z):
    """Korelasi parsial atas peringkat; nilai p adalah pendekatan."""
    rx, ry, rz = (stats.rankdata(v) for v in (x, y, z))

    def resid(a, b):
        A = np.c_[np.ones_like(b), b]
        return a - A @ np.linalg.lstsq(A, a, rcond=None)[0]

    resid_x, resid_y = resid(rx, rz), resid(ry, rz)
    if np.ptp(resid_x) == 0 or np.ptp(resid_y) == 0:
        return np.nan, np.nan
    rho, p = stats.pearsonr(resid_x, resid_y)
    return float(rho), float(p)


def r_squared(y, *predictors):
    """R² OLS dengan intersep; mengembalikan R² dan adjusted R²."""
    y = np.asarray(y, dtype=float)
    predictors = [np.asarray(x, dtype=float) for x in predictors]
    X = np.column_stack([np.ones(len(y)), *predictors])
    if len(y) <= X.shape[1] or np.ptp(y) == 0:
        return np.nan, np.nan

    coefficients, *_ = np.linalg.lstsq(X, y, rcond=None)
    residual_sum_squares = float(np.sum((y - X @ coefficients) ** 2))
    total_sum_squares = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - residual_sum_squares / total_sum_squares
    adjusted_r2 = 1 - (1 - r2) * (len(y) - 1) / (len(y) - X.shape[1])
    return float(r2), float(adjusted_r2)


def analisis(tab: pd.DataFrame, series: dict) -> pd.DataFrame:
    log("\n" + "=" * 70)
    log("PENGARUH VARIABEL PERANCU: KEPADATAN PENDUDUK")
    log(
        "Korelasi Spearman dan R² dari regresi linear OLS; "
        "korelasi parsial mengontrol kepadatan (aproksimasi)."
    )
    log("=" * 70)

    baris = []
    for col, label in series.items():
        d = tab[[col, "kepadatan", "insiden"]].apply(pd.to_numeric, errors="coerce").dropna()
        d = d[d["kepadatan"] > 0]
        if len(d) < 10:
            log(f"{label}: hanya {len(d)} kelurahan lengkap; perlu minimal 10, dilewati.")
            continue

        rho_risk_density, p_risk_density, _ = korelasi_spearman(d[col], d["kepadatan"])
        rho_density_incidence, p_density_incidence, _ = korelasi_spearman(
            d["kepadatan"], d["insiden"]
        )
        rho_raw, p_raw, _ = korelasi_spearman(d[col], d["insiden"])
        rho_adjusted, p_adjusted = spearman_parsial(d[col], d["insiden"], d["kepadatan"])
        r2_risk_density, _ = r_squared(d["kepadatan"], d[col])
        r2_density_incidence, _ = r_squared(d["insiden"], d["kepadatan"])
        r2_raw, _ = r_squared(d["insiden"], d[col])
        r2_density_only, _ = r_squared(d["insiden"], d["kepadatan"])
        r2_full, adjusted_r2_full = r_squared(d["insiden"], d[col], d["kepadatan"])
        baris.append({
            "seri": label,
            "n_kelurahan": len(d),
            "rho_indeks_kepadatan": rho_risk_density,
            "p_indeks_kepadatan": p_risk_density,
            "r2_kepadatan_dari_indeks_ols": r2_risk_density,
            "rho_kepadatan_insiden": rho_density_incidence,
            "p_kepadatan_insiden": p_density_incidence,
            "r2_insiden_dari_kepadatan_ols": r2_density_incidence,
            "rho_indeks_insiden_mentah": rho_raw,
            "p_indeks_insiden_mentah": p_raw,
            "r2_insiden_dari_indeks_ols": r2_raw,
            "rho_indeks_insiden_kontrol_kepadatan": rho_adjusted,
            "p_parsial_aproksimasi": p_adjusted,
            "r2_insiden_model_kepadatan_saja_ols": r2_density_only,
            "r2_insiden_model_indeks_dan_kepadatan_ols": r2_full,
            "adjusted_r2_model_indeks_dan_kepadatan_ols": adjusted_r2_full,
            "tambahan_r2_indeks_setelah_kepadatan_ols": r2_full - r2_density_only,
        })

        log(
            f"{label:<28} n={len(d):<4} "
            f"indeks~kepadatan={rho_risk_density:+.3f} ({kekuatan(rho_risk_density)}); "
            f"kepadatan~insiden={rho_density_incidence:+.3f}; "
            f"indeks~insiden mentah={rho_raw:+.3f}; "
            f"setelah kontrol={rho_adjusted:+.3f} (p~{p_adjusted:.3g}); "
            f"R² insiden~kepadatan={r2_density_only:.3f}; "
            f"R² insiden~indeks+kepadatan={r2_full:.3f}; "
            f"tambahan R² indeks={r2_full - r2_density_only:+.3f}"
        )

        if np.isfinite(rho_raw) and np.isfinite(rho_adjusted):
            perubahan = abs(rho_raw) - abs(rho_adjusted)
            if perubahan > 0.1:
                interpretasi = "asosiasi indeks-insiden melemah setelah kepadatan dikontrol"
            elif perubahan < -0.1:
                interpretasi = "asosiasi indeks-insiden menguat setelah kepadatan dikontrol"
            else:
                interpretasi = "asosiasi indeks-insiden relatif serupa setelah kepadatan dikontrol"
        else:
            interpretasi = "asosiasi tidak dapat dibandingkan karena variasi data tidak memadai"
        log(
            f"  Interpretasi: indeks berkorelasi {kekuatan(rho_risk_density)} "
            f"dengan kepadatan; {interpretasi}."
        )

    if not baris:
        raise SystemExit(
            "Tidak ada seri dengan minimal 10 kelurahan yang memiliki skor risiko, "
            "kepadatan, dan insiden valid. Periksa nama kolom, kecocokan nama, dan luas poligon."
        )
    log(
        "Catatan: hubungan yang dihitung bersifat asosiasi tingkat kelurahan, bukan bukti "
        "sebab-akibat. Korelasi parsial menggunakan residual peringkat dan nilai p-nya "
        "merupakan pendekatan. R² dihitung dari regresi linear OLS atas nilai asli, "
        "bukan kuadrat korelasi Spearman; tambahan R² membandingkan model kepadatan saja "
        "dengan model indeks dan kepadatan."
    )
    return pd.DataFrame(baris).set_index("seri")


# ============================================================
# 3. PROGRAM UTAMA
# ============================================================
def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_df = baca_csv(CSV_PATH)

    if GABUNGAN_CSV:
        tab, series = muat_gabungan(csv_df)
    else:
        shps = {q: baca_shp(q, p) for q, p in SHP_PATHS.items()}
        tab = gabung_tabel(csv_df, shps)

        first_shp = next(iter(shps.values()))
        luas = luas_km2(first_shp)
        luas = luas[~luas.index.duplicated()]
        luas.index = luas.index.map(lambda k: NAME_OVERRIDES.get(k, k))
        mp = peta_nama_fuzzy(list(luas.index), csv_df["key"])
        luas.index = luas.index.map(lambda k: mp.get(k, k))
        luas = luas[~luas.index.duplicated()]
        tab["luas_km2"] = tab["key"].map(luas)
        n_tanpa = int(tab["luas_km2"].isna().sum())
        log(f"Kepadatan tersedia untuk {len(tab) - n_tanpa}/{len(tab)} kelurahan")
        tab["kepadatan"] = tab["penduduk_total"] / tab["luas_km2"].where(tab["luas_km2"] > 0)

        series = {f"risk_{q}": f"SHP {q}" for q in shps}
        series["risk_mean4"] = "Rata-rata 4 kuartal"
        if "risk_csv" in tab.columns:
            series["risk_csv"] = "Kolom risiko di CSV"

    if "kepadatan" not in tab or not tab["kepadatan"].notna().any():
        raise SystemExit(
            "Kepadatan penduduk tidak tersedia. Mode CSV gabungan harus menyertakan "
            "kolom luas_km2 yang valid; mode SHP menghitungnya dari geometri."
        )

    hasil = analisis(tab, series)
    hasil.to_csv(OUT_DIR / "analisis_perancu_kepadatan.csv", encoding="utf-8-sig")
    log(f"\nSelesai. Hasil analisis kepadatan ada di: {OUT_DIR}")
    (OUT_DIR / "laporan_perancu_kepadatan.txt").write_text(
        "\n".join(LOG), encoding="utf-8"
    )


if __name__ == "__main__":
    main()