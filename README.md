# OSM Terrain Studio

A browser-based tool for **viewing, editing and exporting OpenStreetMap data for
any area you choose**. Search a place, rotate the map, draw a georeferenced
rectangle, set its **exact size in kilometres**, **rotate** it to line up with a
road, runway or coastline, measure distances, and then **export** what you need —
vector data (`.osm` / GeoJSON / CSV), **satellite or basemap imagery**, and
**heightmaps** — as the full dataset, clipped to the box, or clipped to a
**freehand region**.

It's useful for GIS work, CAD/3D and mapping projects, field planning, data
journalism, research, or any time you need a precisely-defined slice of the real
world in real units. Exports include **local metre coordinates** so the data
drops straight into tools that expect a flat X/Z grid.

Everything runs **100% in the browser** (no backend, no API keys), so you can
host it for free on GitHub Pages.

---

## Features

- **Place search** — find any location/address (OpenStreetMap Nominatim) and fly
  there; the selection box re-centres with it.
- **Rotate the whole map** — right-click + drag, the compass control, or type an
  exact rotation in **Scene & share**.
- **Selection box** — draw a rectangle or type exact coordinates; set width (X)
  and height (Z) in kilometres, use presets (`1×1` … `10×10`), swap W/H, scale by
  ±10% / ×2 / ÷2.
- **Rotate the box** — slider, numeric input, fine (`±1°`) / coarse (`±45°`)
  nudges, or drag the cyan rotate handle. The orange dot is the local origin
  `(x=0, z=0)`.
- **Free draw** — trace any freehand region and export data clipped to that shape.
- **Measure tool** — click points to measure per-segment and total distance,
  bearings, and straight-line distance.
- **Load data** — upload an `.osm` file (drag & drop works), or **fetch the box
  area** from the Overpass API (with mirror fallback + timeouts so it never hangs).
- **Basic editing** — click a road / building / point to edit tags, move nodes, or
  delete features.
- **Scene & share** — a copyable, screenshot-friendly summary of the exact view
  (map centre/zoom/rotation, box centre/size/rotation, corners, bbox), one-click
  **share link** (permalink that restores the whole scene), and **Open in OSM /
  Google Maps** so the same spot opens identically elsewhere.
- **Keyboard shortcuts** and a built-in **help/about panel** (the `?` button).
- **Terrain bundle (one click):** a single `.zip` with everything aligned to the
  box — roads/rivers (`.osm` + local-metre GeoJSON + WGS84 GeoJSON), a **heightmap**
  (16-bit PNG + RAW + JSON), a **clean satellite image** (PNG), and a **README**
  with Blender/Unity steps. The map data is fetched automatically if you haven't
  loaded it yet, and the heightmap and satellite image share the **same rectangle,
  orientation and pixel grid** so they overlay perfectly. Drop it onto a plane and
  go. You can also grab each piece individually.
- **Advanced exports:**
  - **Vector — direct:** the full loaded dataset as `.osm` or GeoJSON.
  - **Vector — clipped to box:** GeoJSON (WGS84) and a line/road-vertex **CSV**
    (local metres + lat/lon).
  - **Vector — clipped to freehand region:** `.osm` and GeoJSON.
  - **Imagery:** an orthorectified PNG of the box (current basemap), plus freehand
    region images.
  - **Square heightmap:** a forced `513/1025/2049` grid for Unity terrains.

---

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL. To try it instantly, drag `examples/sample.osm` onto the
map.

### Typical workflow

1. **Find your area.** Use the search box, or pan/zoom the map.
2. **Position the box.** Set **Width (X)** and **Height (Z)** in km. Drag the box
   body to move it; drag the cyan handle (or type a value) to rotate it so its
   edges line up however you like. The orange dot is the south-west origin.
3. **Export.** In **Terrain export**, pick a resolution and hit **Export terrain
   bundle (.zip)** — it fetches the OSM data for the box automatically and gives
   you roads/rivers + heightmap + satellite image, all aligned. (Or load your own
   `.osm` first via **Fetch box area** / upload; areas ≤ 120 km².)
4. **Build.** Follow the README in the ZIP: scale a plane to the box size, use the
   heightmap as a Displace texture, project the satellite image as base color, and
   import the local-metre GeoJSON for road/river curves.
5. **Share / reproduce.** Use **Scene & share** to copy a permalink or the full
   state so anyone can open the exact same view.

---

## Coordinate system (the important bit)

The *local metres* and CSV exports use a **local tangent-plane (ENU) projection**
centred on the box:

- `x` → local **X** axis (east when bearing = 0), in metres
- `z` → local **Z** axis (north when bearing = 0), in metres
- Origin `(0, 0)` is the box corner that is **south-west when bearing = 0**
  (the orange handle).
- `bearing` (degrees clockwise from north) is how much the box is rotated.
- For Y-up tools, treat `x` as X, `z` as Z, and sample terrain height for Y at
  `(x, z)` (e.g. from the exported heightmap).

The CSV has one row per line vertex with both local metres and lat/lon:

```
road_id,name,highway,vertex_index,x_m,z_m,lat,lon
```

The *local metres* GeoJSON is a normal FeatureCollection whose coordinates are
`[x, z]` metres instead of `[lon, lat]`, plus a `metadata` block with the size,
bearing, and origin lat/lon.

The **heightmap JSON** records the output resolution and the min/max elevation in
metres, with the formula `elevation_m = min + (value / 65535) * (max - min)` so
you can restore true heights in any software.

> **Accuracy:** the tangent-plane approximation distorts by roughly **0.05 %** at
> the edges of a multi-kilometre box (about 2–3 m over 5 km) — well inside OSM's
> own positional accuracy. Distances and angles inside the box are effectively
> exact.

---

## Keyboard shortcuts

| Key            | Action                                            |
| -------------- | ------------------------------------------------- |
| `V` / `Esc`    | Pan / select (Esc also cancels & deselects)       |
| `D`            | Draw box tool                                     |
| `F`            | Free draw region tool                             |
| `M`            | Measure tool                                      |
| `B`            | Show / hide the box                               |
| `Z`            | Zoom to box                                       |
| `R`            | Reset map rotation to north                       |
| `[` / `]`      | Rotate box −1° / +1°                              |
| `Del` / `⌫`    | Delete selected feature                           |
| `1`–`4`        | Basemap: Dark / Light / Streets / Satellite       |
| `?`            | Open help                                          |

---

## Editing

Switch to **Pan / select**, then click a feature:

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
OSM parsing, the local-projection math, tile sampling, and all exporters are
dependency-free and live in `src/lib/`.

---

## About

Made by **[RTB Ruhan](https://rtbruhan.github.io)**.

Code is released under the [MIT License](./LICENSE).

Map **data** is © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, licensed under the **ODbL** — keep the attribution if you publish
maps or derived data. Basemap tiles are © their respective providers (CARTO,
Esri, OpenStreetMap). Elevation comes from the Terrarium tiles on the AWS
elevation-tiles-prod open dataset. The Overpass and Nominatim APIs are shared
community resources — keep requests reasonably small.
