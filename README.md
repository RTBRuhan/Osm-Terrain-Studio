# OSM Terrain Studio

A browser-based tool for turning **OpenStreetMap data into game-ready terrain
data**. Rotate the map, draw a georeferenced rectangle, set its **exact size in
kilometres**, **rotate** it to line up with a road or coastline, then **export**
the clipped data as OSM, GeoJSON, or **terrain-local metre coordinates** ready
for Unity / [EasyRoad3D](https://www.easyroads3d.com/).

It was built to solve a specific, annoying problem: *"My Unity terrain is
5 km × 10 km and I want to replicate a real place — accurate road layout, real
distances — but I can't draw a box that matches my terrain size, and I can't
rotate it to fit."* This does exactly that.

Everything runs **100% in the browser** (no backend, no API keys), so you can
host it for free on GitHub Pages.

---

## Features

- **Rotate the whole map** — drag with the right mouse button (or use the
  compass control). Useful for visually aligning to a feature before you box it.
- **Draw a selection box** — switch to *Draw box* and drag a rectangle, or type
  exact coordinates.
- **Set exact dimensions** — enter width (X) and height (Z) in kilometres, or
  use presets (`1×1`, `2×2`, `5×5`, `5×10`, `10×10`), swap W/H, and scale by
  ±10% / ×2 / ÷2.
- **Rotate the box** — slider + fine (`±1°`) and coarse (`±45°`) nudges, or drag
  the cyan rotate handle on the map. The orange dot marks the terrain origin
  `(x=0, z=0)`.
- **Load data** — upload an `.osm` file (the format you get from *Export* on
  openstreetmap.org), or **fetch the box area directly** from the Overpass API.
- **Basic editing** — click any road / building / POI to select it, edit its
  tags, move nodes, or delete features.
- **Exports** (all clipped to the box):
  - **OSM XML** — standard, re-importable into JOSM / other tools.
  - **GeoJSON (WGS84)** — for QGIS, Mapbox, web maps, etc.
  - **GeoJSON (local metres)** — same data but coordinates are terrain-local
    metres `[x, z]` instead of `[lon, lat]`.
  - **Unity / EasyRoad3D roads (JSON)** — oriented road centrelines in terrain
    metres + terrain metadata (size, origin lat/lon, bearing).
  - **Road vertices (CSV)** — one row per vertex with both local metres and
    lat/lon.

---

## Quick start

### Use it (local)

```bash
npm install
npm run dev
```

Open the printed URL. To try it instantly, drag `examples/sample.osm` onto the
map.

### Typical workflow: match a Unity terrain

1. **Position the box.** Pan/zoom to your area. Set **Width (X)** and
   **Height (Z)** to match your Unity terrain (e.g. `5` and `10` km). Drag the
   box by its body to move it.
2. **Rotate to fit.** Use the rotation slider/handle so the box edges line up
   with the orientation you want in-game. The orange dot is your terrain's
   south-west origin.
3. **Get the data.** Either upload an `.osm` export, or click **Fetch box area**
   to pull live OSM data for the box (areas ≤ 120 km²).
4. **Export.** Click **Unity / EasyRoad3D roads (.json)**. You also get the
   terrain origin lat/lon and bearing in the *Export* panel for reference.

---

## Export formats in detail

### Coordinate system (the important bit)

Local/Unity exports use a **local tangent-plane (ENU) projection** centred on the
box:

- `x` → Unity **X** axis (east when bearing = 0), in metres
- `z` → Unity **Z** axis (north when bearing = 0), in metres
- Origin `(0, 0)` is the box corner that is **south-west when bearing = 0**
  (the orange handle). Place this at your terrain's bottom-left corner.
- `bearing` (degrees clockwise from north) is how much the box is rotated.
- Unity **Y** is up — sample your terrain's height at `(x, z)`; exported points
  have no `y` (treat as 0).

> **Accuracy:** the tangent-plane approximation distorts by roughly **0.05 %**
> at the edges of a multi-kilometre box (about 2–3 m over 5 km) — well inside
> OSM's own positional accuracy. Distances and angles inside the box are
> effectively exact for level-design purposes.

### Unity roads JSON schema

```jsonc
{
  "format": "osm-terrain-studio/unity-roads@1",
  "terrain": {
    "sizeXMeters": 5000,
    "sizeZMeters": 10000,
    "bearingDeg": 32.5,
    "origin": { "lat": 51.49, "lon": -0.14, "description": "…" },
    "center": { "lat": 51.5, "lon": -0.12 },
    "axes": { "x": "…", "z": "…", "up": "…" }
  },
  "summary": { "roadCount": 42, "totalRoadLengthMeters": 18234.5 },
  "roads": [
    {
      "id": "-12",
      "name": "Diagonal Avenue",
      "highway": "primary",
      "lanes": 4,
      "oneway": false,
      "width": 14,          // estimated carriageway width (m)
      "lengthMeters": 812.3,
      "closed": false,
      "points": [ { "x": 0, "z": 5103.2 }, { "x": 240.1, "z": 5210.7 } ]
    }
  ]
}
```

### Consuming it in Unity with EasyRoad3D (runtime example)

```csharp
using System.IO;
using UnityEngine;
using EasyRoads3Dv3;

[System.Serializable] public class Pt { public float x, z; }
[System.Serializable] public class Road { public string name; public float width; public Pt[] points; }
[System.Serializable] public class Export { public Road[] roads; }

public class OsmRoadImporter : MonoBehaviour
{
    public TextAsset json;          // the exported *-unity-roads.json
    public Terrain terrain;         // optional: to sample heights

    void Start()
    {
        var data = JsonUtility.FromJson<Export>(json.text);
        var net = new ERRoadNetwork();

        foreach (var r in data.roads)
        {
            var markers = new Vector3[r.points.Length];
            for (int i = 0; i < r.points.Length; i++)
            {
                float x = r.points[i].x;
                float z = r.points[i].z;
                float y = terrain ? terrain.SampleHeight(new Vector3(x, 0, z)) : 0f;
                markers[i] = new Vector3(x, y, z);
            }
            var road = net.CreateRoad(string.IsNullOrEmpty(r.name) ? "road" : r.name, markers);
            road.SetWidth(Mathf.Max(2f, r.width));
        }
        net.BuildRoadNetwork();
    }
}
```

Because the coordinates are already terrain-local metres with `(0,0)` at the
terrain corner, the roads line up 1:1 with your terrain — no manual scaling or
georeferencing needed.

---

## Editing

Switch to **Pan / Edit**, then click a feature:

- Edit, add, or remove **tags** (key/value).
- For nodes, change **lat/lon** numerically or drag the selected point on the map.
- **Delete** a way or node (deleting a node also removes it from any ways).

Re-export at any time — edits are reflected in every format.

---

## Deploy to GitHub Pages

1. Create a repo named **`osm-terrain-studio`** and push this project.
2. In **Settings → Pages**, set *Source* to **GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`) builds
   and deploys automatically.

Using a **different repo name**? The site is served from `/<repo>/`, so set the
base path: edit the `VITE_BASE` env in the workflow (e.g. `VITE_BASE=/my-name/`)
or run `VITE_BASE=/my-name/ npm run build`. For a user/org page
(`<user>.github.io`) or custom domain, use `VITE_BASE=/`.

---

## Development

```bash
npm install
npm run dev      # start dev server
npm run check    # headless geometry + export self-checks
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```

**Tech:** React 19 · TypeScript · Vite · Tailwind CSS · MapLibre GL JS.
OSM parsing, the local-projection math, and all exporters are dependency-free
and live in `src/lib/`.

---

## License & attribution

Code is released under the [MIT License](./LICENSE).

Map **data** is © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, licensed under the **ODbL** — keep the attribution if you publish
maps or derived data. Basemap tiles are © their respective providers (CARTO,
Esri, OpenStreetMap); respect each provider's usage policy. The Overpass API is
a shared community resource — keep requests reasonably small.
