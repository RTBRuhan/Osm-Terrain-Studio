/**
 * Export pipeline: clip OSM data to the georeferenced box, then emit it in the
 * formats people actually need – standard OSM/GeoJSON for GIS tools, and
 * terrain-local metre coordinates for game engines (Unity / EasyRoad3D).
 */
import {
  BoxFrame,
  clipPolygon,
  clipPolyline,
  pointInRect,
  type Box,
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
// Road helpers
// ---------------------------------------------------------------------------

const ROAD_DEFAULT_WIDTH: Record<string, number> = {
  motorway: 14,
  trunk: 12,
  primary: 10,
  secondary: 9,
  tertiary: 8,
  residential: 6,
  service: 4,
  unclassified: 6,
  living_street: 5,
  track: 3.5,
  footway: 1.8,
  path: 1.2,
  cycleway: 2,
  pedestrian: 4,
};

/** Estimate carriageway width (m) from tags – lanes win, else a per-class default. */
export function estimateRoadWidth(tags: Tags): number {
  if (tags.width) {
    const w = parseFloat(tags.width);
    if (Number.isFinite(w)) return w;
  }
  const lanes = tags.lanes ? parseInt(tags.lanes, 10) : undefined;
  if (lanes && Number.isFinite(lanes)) return lanes * 3.5;
  return ROAD_DEFAULT_WIDTH[tags.highway ?? ""] ?? 5;
}

function polylineLength(points: LocalXZ[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return len;
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

export interface UnityRoad {
  id: string;
  name?: string;
  highway?: string;
  type?: string;
  lanes?: number;
  oneway: boolean;
  width: number;
  lengthMeters: number;
  closed: boolean;
  points: { x: number; z: number }[];
}

export interface UnityExport {
  format: string;
  generator: string;
  generatedAt: string;
  terrain: {
    sizeXMeters: number;
    sizeZMeters: number;
    bearingDeg: number;
    origin: { lat: number; lon: number; description: string };
    center: { lat: number; lon: number };
    axes: { x: string; z: string; up: string };
    note: string;
  };
  summary: { roadCount: number; totalRoadLengthMeters: number };
  roads: UnityRoad[];
}

/** Build the Unity / EasyRoad3D oriented road manifest from clipped data. */
export function buildUnityExport(
  data: OsmData,
  box: Box,
  filter: RoadFilter,
): UnityExport {
  const { clipped, frame } = clipOsmToBox(data, box);
  const origin = frame.toLatLonFromLocal(0, 0);
  const roads: UnityRoad[] = [];
  let totalLen = 0;

  for (const way of clipped.ways.values()) {
    if (!wayIsExportableLine(way.tags, filter)) continue;
    const pts: LocalXZ[] = [];
    for (const ref of way.refs) {
      const n = clipped.nodes.get(ref);
      if (n) pts.push(frame.toLocal(n.lat, n.lon));
    }
    if (pts.length < 2) continue;
    const len = polylineLength(pts);
    totalLen += len;
    const closed =
      way.refs.length > 2 && way.refs[0] === way.refs[way.refs.length - 1];
    roads.push({
      id: way.id,
      name: way.tags.name,
      highway: way.tags.highway,
      type: way.tags.highway ?? way.tags.railway ?? way.tags.waterway,
      lanes: way.tags.lanes ? Number(way.tags.lanes) : undefined,
      oneway: way.tags.oneway === "yes" || way.tags.oneway === "true",
      width: estimateRoadWidth(way.tags),
      lengthMeters: Math.round(len * 100) / 100,
      closed,
      points: pts.map((p) => ({
        x: Math.round(p.x * 1000) / 1000,
        z: Math.round(p.z * 1000) / 1000,
      })),
    });
  }

  return {
    format: "osm-terrain-studio/unity-roads@1",
    generator: "OSM Terrain Studio",
    generatedAt: new Date().toISOString(),
    terrain: {
      sizeXMeters: box.widthM,
      sizeZMeters: box.heightM,
      bearingDeg: box.bearingDeg,
      origin: {
        lat: origin.lat,
        lon: origin.lon,
        description:
          "Terrain-local origin (x=0, z=0). Place this at the Unity terrain's bottom-left/south-west corner.",
      },
      center: { lat: box.centerLat, lon: box.centerLon },
      axes: {
        x: "Unity X (east at bearing 0), metres",
        z: "Unity Z (north at bearing 0), metres",
        up: "Unity Y is up; sample terrain height at (x,z). Points are emitted with y omitted (treat as 0).",
      },
      note: "Coordinates are metres in the terrain's local frame after applying bearing rotation. Feed road points to EasyRoad3D as Vector3(x, terrainHeight(x,z), z).",
    },
    summary: {
      roadCount: roads.length,
      totalRoadLengthMeters: Math.round(totalLen * 100) / 100,
    },
    roads,
  };
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

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

export function downloadText(
  filename: string,
  text: string,
  mime = "text/plain",
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
