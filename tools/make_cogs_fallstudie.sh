#!/usr/bin/env bash
# Stufe 2 · Fallstudie Zelle 23 (10 km): Hillshade + 8 Fach-Layer -> COG (EPSG:4326)
# Ausführen im eigenen Terminal (Volume-Zugriff). Rohdaten werden nur gelesen.
set -euo pipefail

FS="/Volumes/Crucial X9/Geo_85_Lokales_Projekt/03_Ergebnisse/Fallstudie_Zelle23_10km"
OUT="/Volumes/Crucial X9/Geo_85_Lokales_Projekt/03_Ergebnisse/Webportal/cog/fallstudie"
mkdir -p "$OUT"
COGCO=(-co COMPRESS=DEFLATE -co OVERVIEWS=AUTO -co BLOCKSIZE=256)

echo "[1/9] Hillshade (aus 25-m-DEM)"
gdaldem hillshade "$FS/clip_dem.tif" "$OUT/_hs_utm.tif" -z 1.5 -az 315 -alt 45 -compute_edges -q
gdalwarp -q -overwrite -t_srs EPSG:4326 -r bilinear -of COG "${COGCO[@]}" \
         "$OUT/_hs_utm.tif" "$OUT/hillshade.tif"
rm -f "$OUT/_hs_utm.tif"

i=2
for pair in dem:clip_dem slope:clip_slope_deg twi:clip_twi awc:clip_awc rzsm:clip_rzsm_mm \
            exceed_frac:clip_exceed_frac exceed_dry:clip_exceed_dry exceed_wet:clip_exceed_wet; do
  name=${pair%%:*}; src=${pair##*:}
  echo "[$i/9] $name"
  gdalwarp -q -overwrite -t_srs EPSG:4326 -r bilinear -dstnodata -9999 \
           -of COG "${COGCO[@]}" "$FS/$src.tif" "$OUT/$name.tif"
  i=$((i+1))
done

echo ""
echo "fertig -> $OUT"
ls -la "$OUT" | grep -v '\._'
