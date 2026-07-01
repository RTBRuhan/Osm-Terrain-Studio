/**
 * Scene state: a compact, portable description of "what you're looking at" so it
 * can be screenshotted, copied, shared as a link, or pasted into other map tools
 * (OpenStreetMap, Google Maps, geo: URIs) to reproduce the exact same view.
 */
import { BoxFrame, type Box, type LatLon } from "./geo";
import type { BasemapId } from "./basemaps";

export interface MapViewState {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
}

export interface SceneState {
  box: Box;
  view: MapViewState;
  basemap: BasemapId;
}

export interface BoxCorners {
  sw: LatLon;
  se: LatLon;
  ne: LatLon;
  nw: LatLon;
}

export function boxCorners(box: Box): BoxCorners {
  const f = new BoxFrame(box);
  return {
    sw: f.toLatLonFromLocal(0, 0),
    se: f.toLatLonFromLocal(box.widthM, 0),
    ne: f.toLatLonFromLocal(box.widthM, box.heightM),
    nw: f.toLatLonFromLocal(0, box.heightM),
  };
}

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export function boxBBox(box: Box): BBox {
  const f = new BoxFrame(box);
  const ring = f.cornerRing();
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLon, minLat, maxLon, maxLat };
}

export function osmLink(view: MapViewState): string {
  const z = Math.round(view.zoom);
  return `https://www.openstreetmap.org/#map=${z}/${view.lat.toFixed(5)}/${view.lng.toFixed(5)}`;
}

export function googleMapsLink(view: MapViewState): string {
  return `https://www.google.com/maps/@${view.lat.toFixed(6)},${view.lng.toFixed(6)},${Math.round(view.zoom)}z`;
}

export function geoUri(p: LatLon): string {
  return `geo:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
}

const f6 = (n: number) => n.toFixed(6);
const f1 = (n: number) => n.toFixed(1);

/** A human-readable, copy/paste-friendly summary of the whole scene. */
export function buildSceneSummary(state: SceneState): string {
  const { box, view } = state;
  const c = boxCorners(box);
  const bb = boxBBox(box);
  return [
    "OSM Terrain Studio — scene state",
    "",
    "[Map view]",
    `center:   ${f6(view.lat)}, ${f6(view.lng)}`,
    `zoom:     ${view.zoom.toFixed(2)}`,
    `rotation: ${f1(((view.bearing % 360) + 360) % 360)}° (clockwise from north)`,
    `basemap:  ${state.basemap}`,
    "",
    "[Selection box]",
    `center:   ${f6(box.centerLat)}, ${f6(box.centerLon)}`,
    `size:     ${(box.widthM / 1000).toFixed(3)} km (W/X) x ${(box.heightM / 1000).toFixed(3)} km (H/Z)`,
    `size:     ${Math.round(box.widthM)} m x ${Math.round(box.heightM)} m`,
    `rotation: ${f1(((box.bearingDeg % 360) + 360) % 360)}° (clockwise from north)`,
    `area:     ${((box.widthM * box.heightM) / 1e6).toFixed(4)} km²`,
    "",
    "[Box corners] (lat, lon)",
    `SW: ${f6(c.sw.lat)}, ${f6(c.sw.lon)}`,
    `SE: ${f6(c.se.lat)}, ${f6(c.se.lon)}`,
    `NE: ${f6(c.ne.lat)}, ${f6(c.ne.lon)}`,
    `NW: ${f6(c.nw.lat)}, ${f6(c.nw.lon)}`,
    "",
    "[Bounding box]",
    `bbox (minLon,minLat,maxLon,maxLat): ${f6(bb.minLon)},${f6(bb.minLat)},${f6(bb.maxLon)},${f6(bb.maxLat)}`,
    `bbox (S,W,N,E for Overpass):        ${f6(bb.minLat)},${f6(bb.minLon)},${f6(bb.maxLat)},${f6(bb.maxLon)}`,
    "",
    "[Links]",
    `OpenStreetMap: ${osmLink(view)}`,
    `Google Maps:   ${googleMapsLink(view)}`,
  ].join("\n");
}

/** Human-readable README bundled with a terrain export ZIP. */
export function buildTerrainReadme(opts: {
  box: Box;
  basemap: string;
  fileBase: string;
  image: { width: number; height: number };
  elevation: { min: number; max: number };
  hasVector: boolean;
}): string {
  const { box, fileBase: b, image, elevation } = opts;
  const c = boxCorners(box);
  const bb = boxBBox(box);
  const range = Math.max(0, elevation.max - elevation.min);
  const wKm = (box.widthM / 1000).toFixed(3);
  const hKm = (box.heightM / 1000).toFixed(3);
  const lines = [
    "OSM Terrain Studio — terrain export",
    `Generated: ${new Date().toISOString()}`,
    "",
    "================ AREA ================",
    `Box center (lat, lon): ${f6(box.centerLat)}, ${f6(box.centerLon)}`,
    `Box size: ${wKm} km (X / width, east) x ${hKm} km (Y / height, north)`,
    `Box size: ${Math.round(box.widthM)} m x ${Math.round(box.heightM)} m`,
    `Box rotation: ${f1(((box.bearingDeg % 360) + 360) % 360)} deg clockwise from north`,
    `Corners (lat, lon):`,
    `  NW ${f6(c.nw.lat)}, ${f6(c.nw.lon)}   NE ${f6(c.ne.lat)}, ${f6(c.ne.lon)}`,
    `  SW ${f6(c.sw.lat)}, ${f6(c.sw.lon)}   SE ${f6(c.se.lat)}, ${f6(c.se.lon)}`,
    `Bounding box (minLon,minLat,maxLon,maxLat): ${f6(bb.minLon)},${f6(bb.minLat)},${f6(bb.maxLon)},${f6(bb.maxLat)}`,
    "",
    "================ FILES ================",
  ];
  if (opts.hasVector) {
    lines.push(
      `${b}-clipped.osm      OSM vector data clipped exactly to the box (roads, rivers, water, buildings...).`,
      `${b}-local.geojson    Same data in LOCAL METRES. Coordinates are [x, y] where`,
      `                      x = 0..${Math.round(box.widthM)} (east), y = 0..${Math.round(box.heightM)} (north). Best for Blender/Unity.`,
      `${b}-wgs84.geojson    Same data in lat/lon (for GIS tools).`,
    );
  }
  lines.push(
    `${b}-satellite-${image.width}x${image.height}.png   Clean aerial image of the box (north-up in the box frame).`,
    `${b}-heightmap-${image.width}x${image.height}.png    16-bit grayscale elevation, SAME framing & pixel grid as the satellite image.`,
    `${b}-heightmap-${image.width}x${image.height}.raw    16-bit little-endian raw heightmap (row 0 = north).`,
    `${b}-heightmap.json     Elevation metadata (min/max + reconstruction formula).`,
    "",
    "================ ALIGNMENT (important) ================",
    "The satellite image, the heightmap and the local-metre GeoJSON all describe",
    "the SAME rectangle at the SAME orientation. The two images share the same",
    "pixel grid, so they overlay perfectly:",
    "  - pixel (0,0) = top-left  = NW corner",
    `  - image width  = ${image.width}px = ${wKm} km (east / +X)`,
    `  - image height = ${image.height}px = ${hKm} km (north is UP in the image)`,
    "  - local GeoJSON: x grows right (east), y grows up (north).",
    "",
    "================ ELEVATION ================",
    `Min: ${elevation.min.toFixed(2)} m   Max: ${elevation.max.toFixed(2)} m   Range: ${range.toFixed(2)} m`,
    "Reconstruct true height from the 16-bit value v (0..65535):",
    "  elevation_m = min + (v / 65535) * (max - min)",
    "",
    "================ BLENDER QUICK STEPS ================",
    `1. Add a Plane and scale it to ${wKm} x ${hKm} (e.g. metres). Add plenty of subdivisions.`,
    `2. Add a Displace modifier. Load ${b}-heightmap-*.png as the texture (set it to Non-Color).`,
    `   Set the modifier Strength to ${range.toFixed(1)} (the elevation range in metres) and Midlevel to 0.`,
    `3. Base color: use ${b}-satellite-*.png, projected from the top view (flat UV of the plane).`,
    "4. Roads/rivers: import the local GeoJSON; x -> X, y -> Y (metres), height 0 (drape onto the surface).",
    "",
    "================ UNITY QUICK STEPS ================",
    "1. Create a Terrain sized to the box (Width = X km, Length = Y km in metres).",
    "2. Import the RAW heightmap (16-bit, Windows/little-endian byte order). Set terrain Height to the",
    `   elevation range (${range.toFixed(1)} m) so heights are 1:1.`,
    "3. Apply the satellite PNG as a terrain base texture / orthophoto.",
    "Tip: for Unity, export a SQUARE heightmap (Advanced exports) sized 513/1025/2049.",
    "",
    "Map data (c) OpenStreetMap contributors (ODbL). Imagery (c) its provider (see app).",
  );
  return lines.join("\n");
}

// --- permalink (URL hash) --------------------------------------------------

export function encodeScene(state: SceneState): string {
  const { box, view } = state;
  const params = new URLSearchParams();
  params.set(
    "box",
    [
      box.centerLat.toFixed(6),
      box.centerLon.toFixed(6),
      Math.round(box.widthM),
      Math.round(box.heightM),
      box.bearingDeg.toFixed(1),
    ].join(","),
  );
  params.set(
    "map",
    [
      view.lat.toFixed(6),
      view.lng.toFixed(6),
      view.zoom.toFixed(2),
      view.bearing.toFixed(1),
    ].join(","),
  );
  params.set("base", state.basemap);
  return params.toString();
}

export interface DecodedScene {
  box?: Box;
  view?: MapViewState;
  basemap?: BasemapId;
}

const VALID_BASEMAPS = ["dark", "light", "streets", "satellite"];

export function decodeScene(hash: string): DecodedScene | null {
  const clean = hash.replace(/^#/, "");
  if (!clean) return null;
  const params = new URLSearchParams(clean);
  const out: DecodedScene = {};

  const boxStr = params.get("box");
  if (boxStr) {
    const p = boxStr.split(",").map(Number);
    if (p.length === 5 && p.every((n) => Number.isFinite(n))) {
      out.box = {
        centerLat: p[0],
        centerLon: p[1],
        widthM: p[2],
        heightM: p[3],
        bearingDeg: p[4],
      };
    }
  }

  const mapStr = params.get("map");
  if (mapStr) {
    const p = mapStr.split(",").map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n))) {
      out.view = { lat: p[0], lng: p[1], zoom: p[2], bearing: p[3] };
    }
  }

  const base = params.get("base");
  if (base && VALID_BASEMAPS.includes(base)) out.basemap = base as BasemapId;

  return out.box || out.view || out.basemap ? out : null;
}
