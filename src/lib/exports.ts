/**
 * Export pipeline: clip OSM data to the georeferenced box, then emit it in the
 * formats people actually need – standard OSM/GeoJSON for GIS tools, plus
 * local metre coordinates (CSV / GeoJSON) for CAD, 3D and engine workflows.
 */
import {
  BoxFrame,
  clipPolygon,
  clipPolyline,
  pointInRect,
  pointInRing,
  type Box,
  type LatLon,
  type LocalXZ,
  type Rect,
} from "./geo";
import {
  emptyOsm,
  isAreaWay,
  osmToGeoJSON,
  serializeOsmXml,
  type OsmData,
  type OsmNode,
  type Tags,
} from "./osm";

export interface ClipResult {
  clipped: OsmData;
  frame: BoxFrame;
  rect: Rect;
}

/** Clip an OSM dataset to the (rotated) box, in terrain-local space. */
export function clipOsmToBox(data: OsmData, box: Box): ClipResult {
  const frame = new BoxFrame(box);
  const rect: Rect = { w: box.widthM, h: box.heightM };
  const out = emptyOsm();

  const ring = frame.cornerRing();
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  out.bounds = { minLat, minLon, maxLat, maxLon };

  let nextNodeId = -1;
  let nextWayId = -1;

  const addLocalNode = (p: LocalXZ): string => {
    const ll = frame.toLatLonFromLocal(p.x, p.z);
    const id = String(nextNodeId--);
    out.nodes.set(id, { id, lat: ll.lat, lon: ll.lon, tags: {} });
    return id;
  };

  const localOf = (n: OsmNode): LocalXZ => frame.toLocal(n.lat, n.lon);

  for (const way of data.ways.values()) {
    const nodes = way.refs
      .map((r) => data.nodes.get(r))
      .filter((n): n is OsmNode => Boolean(n));
    if (nodes.length < 2) continue;
    const locals = nodes.map(localOf);
    const allInside = locals.every((p) => pointInRect(p, rect));

    if (allInside) {
      for (const n of nodes) {
        if (!out.nodes.has(n.id))
          out.nodes.set(n.id, { ...n, tags: { ...n.tags } });
      }
      out.ways.set(way.id, {
        id: way.id,
        refs: way.refs.slice(),
        tags: { ...way.tags },
      });
      continue;
    }

    if (isAreaWay(way)) {
      const clipped = clipPolygon(locals, rect);
      if (clipped.length >= 3) {
        const refs = clipped.map(addLocalNode);
        refs.push(refs[0]);
        const wid = String(nextWayId--);
        out.ways.set(wid, { id: wid, refs, tags: { ...way.tags } });
      }
    } else {
      const pieces = clipPolyline(locals, rect);
      for (const piece of pieces) {
        if (piece.length < 2) continue;
        const refs = piece.map(addLocalNode);
        const wid = String(nextWayId--);
        out.ways.set(wid, { id: wid, refs, tags: { ...way.tags } });
      }
    }
  }

  for (const node of data.nodes.values()) {
    if (Object.keys(node.tags).length === 0) continue;
    if (out.nodes.has(node.id)) continue;
    if (!pointInRect(localOf(node), rect)) continue;
    out.nodes.set(node.id, { ...node, tags: { ...node.tags } });
  }

  return { clipped: out, frame, rect };
}

// ---------------------------------------------------------------------------
// Freehand-polygon clipping (a looser, geometry-preserving clip used for the
// freehand selection region – keeps any way that touches the region intact).
// ---------------------------------------------------------------------------

export function clipOsmToPolygon(data: OsmData, ring: LatLon[]): OsmData {
  const out = emptyOsm();
  if (ring.length < 3) return out;

  const inside = (n: OsmNode) => pointInRing(n.lat, n.lon, ring);

  for (const way of data.ways.values()) {
    const nodes = way.refs
      .map((r) => data.nodes.get(r))
      .filter((n): n is OsmNode => Boolean(n));
    if (nodes.length === 0) continue;
    if (!nodes.some(inside)) continue;
    for (const n of nodes) {
      if (!out.nodes.has(n.id)) out.nodes.set(n.id, { ...n, tags: { ...n.tags } });
    }
    out.ways.set(way.id, {
      id: way.id,
      refs: way.refs.slice(),
      tags: { ...way.tags },
    });
  }

  for (const node of data.nodes.values()) {
    if (Object.keys(node.tags).length === 0) continue;
    if (out.nodes.has(node.id)) continue;
    if (inside(node)) out.nodes.set(node.id, { ...node, tags: { ...node.tags } });
  }

  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const p of ring) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  out.bounds = { minLat, minLon, maxLat, maxLon };
  return out;
}

// ---------------------------------------------------------------------------
// Format builders
// ---------------------------------------------------------------------------

export type RoadFilter = "roads" | "roads+paths" | "all-lines";

function wayIsExportableLine(tags: Tags, filter: RoadFilter): boolean {
  const isRoad = Boolean(tags.highway);
  const isPath =
    tags.highway === "footway" ||
    tags.highway === "path" ||
    tags.highway === "cycleway" ||
    tags.highway === "steps" ||
    tags.highway === "pedestrian";
  switch (filter) {
    case "roads":
      return isRoad && !isPath;
    case "roads+paths":
      return isRoad;
    case "all-lines":
      return true;
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

/** GeoJSON in terrain-local metres ([x, z] instead of [lon, lat]). */
export function buildLocalGeoJSON(data: OsmData, box: Box): unknown {
  const { clipped, frame } = clipOsmToBox(data, box);
  const base = osmToGeoJSON(clipped);
  const reproject = (c: [number, number]): [number, number] => {
    // Incoming GeoJSON coords are [lon, lat] -> convert to [x, z] metres.
    const local = frame.toLocal(c[1], c[0]);
    return [Math.round(local.x * 1000) / 1000, Math.round(local.z * 1000) / 1000];
  };
  const features = base.features.map((f) => {
    const g = f.geometry;
    let geometry = g;
    switch (g.type) {
      case "Point":
        geometry = { type: "Point", coordinates: reproject(g.coordinates) };
        break;
      case "LineString":
        geometry = {
          type: "LineString",
          coordinates: g.coordinates.map(reproject),
        };
        break;
      case "Polygon":
        geometry = {
          type: "Polygon",
          coordinates: g.coordinates.map((ring) => ring.map(reproject)),
        };
        break;
      default: {
        const _exhaustive: never = g;
        return _exhaustive;
      }
    }
    return { ...f, geometry };
  });
  return {
    type: "FeatureCollection",
    metadata: {
      crs: "terrain-local-metres",
      sizeXMeters: box.widthM,
      sizeZMeters: box.heightM,
      bearingDeg: box.bearingDeg,
      origin: frame.toLatLonFromLocal(0, 0),
    },
    features,
  };
}

/** CSV: one row per road vertex (both local metres and WGS84). */
export function buildRoadCsv(
  data: OsmData,
  box: Box,
  filter: RoadFilter,
): string {
  const { clipped, frame } = clipOsmToBox(data, box);
  const rows: string[] = [
    "road_id,name,highway,vertex_index,x_m,z_m,lat,lon",
  ];
  const csvField = (s: string): string =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  for (const way of clipped.ways.values()) {
    if (!wayIsExportableLine(way.tags, filter)) continue;
    let i = 0;
    for (const ref of way.refs) {
      const n = clipped.nodes.get(ref);
      if (!n) continue;
      const local = frame.toLocal(n.lat, n.lon);
      rows.push(
        [
          way.id,
          csvField(way.tags.name ?? ""),
          csvField(way.tags.highway ?? ""),
          String(i++),
          (Math.round(local.x * 1000) / 1000).toString(),
          (Math.round(local.z * 1000) / 1000).toString(),
          n.lat.toFixed(7),
          n.lon.toFixed(7),
        ].join(","),
      );
    }
  }
  return rows.join("\n");
}

export function buildClippedOsmXml(data: OsmData, box: Box): string {
  const { clipped } = clipOsmToBox(data, box);
  return serializeOsmXml(clipped, { bounds: clipped.bounds });
}

export function buildClippedGeoJSON(data: OsmData, box: Box): unknown {
  const { clipped } = clipOsmToBox(data, box);
  return osmToGeoJSON(clipped);
}

/** The full, unclipped dataset as OSM XML (a "direct download" of what's loaded). */
export function buildFullOsmXml(data: OsmData): string {
  return serializeOsmXml(data, { bounds: data.bounds });
}

export function buildFullGeoJSON(data: OsmData): unknown {
  return osmToGeoJSON(data);
}

/** OSM XML clipped to the freehand selection region. */
export function buildRegionOsmXml(data: OsmData, ring: LatLon[]): string {
  const clipped = clipOsmToPolygon(data, ring);
  return serializeOsmXml(clipped, { bounds: clipped.bounds });
}

export function buildRegionGeoJSON(data: OsmData, ring: LatLon[]): unknown {
  return osmToGeoJSON(clipOsmToPolygon(data, ring));
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(
  filename: string,
  text: string,
  mime = "text/plain",
): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}
