# Green-Water-Portal — Palouse / Columbia-Basin

Interaktiver Karten-Demonstrator zum Projekt **Geo 85**: Green-Water-Verfügbarkeit
und Bodenfeuchte-Planetary-Boundary in der Palouse-Region (Columbia-Basin, USA).
Er visualisiert die im schriftlichen Bericht dokumentierten Ergebnisse räumlich
(Zell-Raster, Fallstudie, Validierung an SCAN-Stationen).

## Ansehen

- **Online:** `https://<GITHUB-NUTZERNAME>.github.io/<REPO-NAME>/`
  (Link nach Aktivierung von GitHub Pages hier eintragen.)
- **Lokal:** Repo herunterladen und aus dem Projektordner einen kleinen Webserver
  starten (nicht per Doppelklick öffnen — die Kachel-/COG-Daten werden per `fetch`
  geladen und brauchen HTTP):
  ```bash
  cd <projektordner>
  python3 -m http.server 8000
  # dann im Browser: http://localhost:8000
  ```

## Aufbau

| Pfad | Inhalt |
|---|---|
| `index.html`, `app.js`, `app.css` | Anwendung (Vanilla JS, keine Build-Kette) |
| `data/` | Kennzahlen & Vektoren (GeoJSON/JSON): Zellstatistik, AOI, Fallstudie, SCAN |
| `vector/` | Schutzflächen, Bodenkulisse (GeoJSON) |
| `cog/aoi/`, `cog/fallstudie/`, `cog/zellen/` | Cloud-Optimized GeoTIFFs (Raster-Layer) |
| `vendor/` | Lokal gehostete Bibliotheken (Leaflet, georaster, proj4) + Schriften |
| `tools/` | Reproduzierbarkeit: Skript zur COG-Erzeugung |

## Technik

- Vanilla JavaScript + [Leaflet](https://leafletjs.com/) mit
  `georaster-layer-for-leaflet` für die COG-Darstellung — **kein Build-Schritt**,
  alle Bibliotheken liegen lokal unter `vendor/`.
- **Hinweis:** Die Basiskarten (Esri World Imagery, CARTO, OpenStreetMap) werden
  online geladen und benötigen eine Internetverbindung. Alle Projekt-Daten
  (Raster, Vektoren, Kennzahlen) liegen im Repository und werden lokal ausgeliefert.

## Datenprovenienz

- Bodenfeuchte-Ensemble: 4 globale hydrologische Modelle (ISIMIP, vgl. Bericht).
- Höhenmodell: USGS 3DEP · Böden: SSURGO / gNATSGO · SCAN-Stationen: USDA NRCS.
Details, Methodik und Einordnung stehen im schriftlichen Bericht des Projekts Geo 85.

---
*Präsentations-Demonstrator zu Studienzwecken. Zahlen und Aussagen sind im
schriftlichen Bericht belegt und dort maßgeblich.*
