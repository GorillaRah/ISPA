import pandas as pd

# 1. Load the population data CSV
file_path = r"C:\Users\Ardra\Downloads\WebGISKesehatan2web\qgis2web_2026_09_17-15_43_47_334972\qgis2web_2026_09_17-15_43_47_334972\Others\Filedata_Data_Jumlah_Penduduk_Berdasarkan_Usia_PerKelurahan_DKIJakarta.csv"
df = pd.read_csv(file_path, sep=";")

# 2. Select every kelurahan listed in the data
target_kelurahan = df["nama_kelurahan"].dropna().unique()

# 3. Filter for the selected kelurahan and sum the 'jumlah' column
filtered_df = df[df["nama_kelurahan"].isin(target_kelurahan)]
total_penduduk = filtered_df.groupby("nama_kelurahan")["jumlah"].sum()

# 4. Display totals for all kelurahan
print("Total penduduk by Kelurahan:")
print(total_penduduk.to_string())
