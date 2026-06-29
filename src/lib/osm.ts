/**
 * Minimal, dependency-free OpenStreetMap model + parser + serializer.
 *
 * We keep the OSM primitives (nodes / ways / relations) intact so editing and
 * export are lossless round-trips, and we derive GeoJSON on demand purely for
 * rendering and analysis.
 */

export type Tags = Record<string, string>;

export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Tags;
}

export interface OsmWay {
  id: string;
  /** Ordered node ids. */
  refs: string[];
  tags: Tags;
}

export interface OsmRelationMember {
  type: "node" | "way" | "relation";
  ref: string;
  role: string;
}

export interface OsmRelation {
  id: string;
  members: OsmRelationMember[];
  tags: Tags;
}

export interface OsmBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface OsmData {
  nodes: Map<string, OsmNode>;
  ways: Map<string, OsmWay>;
  relations: Map<string, OsmRelation>;
  bounds?: OsmBounds;
}

export function emptyOsm(): OsmData {
  return { nodes: new Map(), ways: new Map(), relations: new Map() };
}

function readTags(el: Element): Tags {
  const tags: Tags = {};
  el.querySelectorAll(":scope > tag").forEach((t) => {
    const k = t.getAttribute("k");
    const v = t.getAttribute("v");
    if (k != null && v != null) tags[k] = v;
  });
  return tags;
}

/** Parse an OSM XML document (the format produced by openstreetmap.org export). */
export function parseOsmXml(xml: string): OsmData {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Could not parse file as OSM XML.");
  }
  const root = doc.querySelector("osm");
  if (!root) {
    throw new Error("Not an OSM file: missing <osm> root element.");
  }

  const data = emptyOsm();

  const boundsEl = root.querySelector("bounds");
  if (boundsEl) {
    data.bounds = {
      minLat: Number(boundsEl.getAttribute("minlat")),
      minLon: Number(boundsEl.getAttribute("minlon")),
      maxLat: Number(boundsEl.getAttribute("maxlat")),
      maxLon: Number(boundsEl.getAttribute("maxlon")),
    };
  }

  root.querySelectorAll(":scope > node").forEach((el) => {
    const id = el.getAttribute("id");
    if (!id) return;
    data.nodes.set(id, {
      id,
      lat: Number(el.getAttribute("lat")),
      lon: Number(el.getAttribute("lon")),
      tags: readTags(el),
    });
  });

  root.querySelectorAll(":scope > way").forEach((el) => {
    const id = el.getAttribute("id");
    if (!id) return;
    const refs: string[] = [];
    el.querySelectorAll(":scope > nd").forEach((nd) => {
      const ref = nd.getAttribute("ref");
      if (ref) refs.push(ref);
    });
    data.ways.set(id, { id, refs, tags: readTags(el) });
  });

  root.querySelectorAll(":scope > relation").forEach((el) => {
    const id = el.getAttribute("id");
    if (!id) return;
    const members: OsmRelationMember[] = [];
    el.querySelectorAll(":scope > member").forEach((m) => {
      const type = m.getAttribute("type");
      const ref = m.getAttribute("ref");
      if ((type === "node" || type === "way" || type === "relation") && ref) {
        members.push({ type, ref, role: m.getAttribute("role") ?? "" });
      }
    });
    data.relations.set(id, { id, members, tags: readTags(el) });
  });

  if (!data.bounds) data.bounds = computeBounds(data) ?? undefined;
  return data;
}

export function computeBounds(data: OsmData): OsmBounds | null {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const n of data.nodes.values()) {
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLat, minLon, maxLat, maxLon };
}

// ---------------------------------------------------------------------------
// Styling classification
// ---------------------------------------------------------------------------

export type FeatureCategory =
  | "road"
  | "rail"
  | "path"
  | "water"
  | "waterway"
  | "building"
  | "green"
  | "poi"
  | "other";

const AREA_KEYS = [
  "building",
  "landuse",
  "leisure",
  "amenity",
  "natural",
  "shop",
  "tourism",
];

export function isAreaWay(way: OsmWay): boolean {
  if (way.tags.area === "yes") return true;
  if (way.tags.area === "no") return false;
  const closed = way.refs.length > 3 && way.refs[0] === way.refs[way.refs.length - 1];
  if (!closed) return false;
  if (way.tags.highway || way.tags.barrier) return false;
  return AREA_KEYS.some((k) => k in way.tags);
}

export function categorize(tags: Tags): FeatureCategory {
  if (tags.highway) {
    if (
      tags.highway === "footway" ||
      tags.highway === "path" ||
      tags.highway === "cycleway" ||
      tags.highway === "steps" ||
      tags.highway === "pedestrian"
    ) {
      return "path";
    }
    return "road";
  }
  if (tags.railway) return "rail";
  if (tags.waterway) return "waterway";
  if (tags.natural === "water" || tags.water || tags.landuse === "reservoir")
    return "water";
  if (tags.building) return "building";
  if (
    tags.leisure === "park" ||
    tags.leisure === "garden" ||
    tags.landuse === "forest" ||
    tags.landuse === "grass" ||
    tags.landuse === "meadow" ||
    tags.natural === "wood" ||
    tags.natural === "grassland"
  ) {
    return "green";
  }
  return "other";
}

/** Road importance rank used for line widths (1 = biggest). */
export function roadRank(highway: string | undefined): number {
  switch (highway) {
    case "motorway":
    case "motorway_link":
      return 1;
    case "trunk":
    case "trunk_link":
      return 2;
    case "primary":
    case "primary_link":
      return 3;
    case "secondary":
    case "secondary_link":
      return 4;
    case "tertiary":
    case "tertiary_link":
      return 5;
    case "residential":
    case "unclassified":
    case "living_street":
      return 6;
    default:
      return 7;
  }
}

// ---------------------------------------------------------------------------
// GeoJSON projection (for rendering / analysis only)
// ---------------------------------------------------------------------------

export interface GeoFeatureProps {
  fid: string;
  el: "way" | "node";
  category: FeatureCategory;
  name?: string;
  highway?: string;
  rank: number;
  tagCount: number;
}

export type GeoJSON = GeoJSONFeatureCollection;
export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}
export interface GeoJSONFeature {
  type: "Feature";
  id?: string;
  properties: GeoFeatureProps;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Polygon"; coordinates: [number, number][][] };
}

export function osmToGeoJSON(data: OsmData): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  for (const way of data.ways.values()) {
    const coords: [number, number][] = [];
    for (const ref of way.refs) {
      const n = data.nodes.get(ref);
      if (n) coords.push([n.lon, n.lat]);
    }
    if (coords.length < 2) continue;
    const category = categorize(way.tags);
    const props: GeoFeatureProps = {
      fid: way.id,
      el: "way",
      category,
      name: way.tags.name,
      highway: way.tags.highway,
      rank: roadRank(way.tags.highway),
      tagCount: Object.keys(way.tags).length,
    };
    if (isAreaWay(way)) {
      const ring = coords.slice();
      if (
        ring.length > 0 &&
        (ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1])
      ) {
        ring.push(ring[0]);
      }
      features.push({
        type: "Feature",
        id: `w${way.id}`,
        properties: props,
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    } else {
      features.push({
        type: "Feature",
        id: `w${way.id}`,
        properties: props,
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }

  // Standalone tagged nodes (POIs) – skip nodes that only exist as way vertices.
  const usedByWay = new Set<string>();
  for (const way of data.ways.values())
    for (const ref of way.refs) usedByWay.add(ref);

  for (const node of data.nodes.values()) {
    const meaningful = Object.keys(node.tags).length > 0;
    if (!meaningful) continue;
    if (usedByWay.has(node.id) && !node.tags.name && !node.tags.amenity)
      continue;
    features.push({
      type: "Feature",
      id: `n${node.id}`,
      properties: {
        fid: node.id,
        el: "node",
        category: "poi",
        name: node.tags.name,
        rank: 7,
        tagCount: Object.keys(node.tags).length,
      },
      geometry: { type: "Point", coordinates: [node.lon, node.lat] },
    });
  }

  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Serialization back to OSM XML
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tagsXml(tags: Tags, indent: string): string {
  return Object.entries(tags)
    .map(
      ([k, v]) =>
        `${indent}<tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`,
    )
    .join("\n");
}

export interface SerializeOptions {
  bounds?: OsmBounds;
  generator?: string;
}

export function serializeOsmXml(data: OsmData, opts: SerializeOptions = {}): string {
  const generator = opts.generator ?? "OSM Terrain Studio";
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<osm version="0.6" generator="${escapeXml(generator)}">`);
  const b = opts.bounds ?? data.bounds;
  if (b) {
    lines.push(
      `  <bounds minlat="${b.minLat}" minlon="${b.minLon}" maxlat="${b.maxLat}" maxlon="${b.maxLon}"/>`,
    );
  }

  for (const node of data.nodes.values()) {
    const hasTags = Object.keys(node.tags).length > 0;
    const open = `  <node id="${escapeXml(node.id)}" lat="${node.lat}" lon="${node.lon}" version="1"`;
    if (!hasTags) {
      lines.push(`${open}/>`);
    } else {
      lines.push(`${open}>`);
      lines.push(tagsXml(node.tags, "    "));
      lines.push("  </node>");
    }
  }

  for (const way of data.ways.values()) {
    lines.push(`  <way id="${escapeXml(way.id)}" version="1">`);
    for (const ref of way.refs) lines.push(`    <nd ref="${escapeXml(ref)}"/>`);
    if (Object.keys(way.tags).length > 0) lines.push(tagsXml(way.tags, "    "));
    lines.push("  </way>");
  }

  for (const rel of data.relations.values()) {
    lines.push(`  <relation id="${escapeXml(rel.id)}" version="1">`);
    for (const m of rel.members) {
      lines.push(
        `    <member type="${m.type}" ref="${escapeXml(m.ref)}" role="${escapeXml(m.role)}"/>`,
      );
    }
    if (Object.keys(rel.tags).length > 0) lines.push(tagsXml(rel.tags, "    "));
    lines.push("  </relation>");
  }

  lines.push("</osm>");
  return lines.join("\n");
}

/** Stats for the data panel. */
export interface OsmStats {
  nodes: number;
  ways: number;
  relations: number;
  roads: number;
  buildings: number;
}

export function computeStats(data: OsmData): OsmStats {
  let roads = 0;
  let buildings = 0;
  for (const w of data.ways.values()) {
    if (w.tags.highway) roads++;
    if (w.tags.building) buildings++;
  }
  return {
    nodes: data.nodes.size,
    ways: data.ways.size,
    relations: data.relations.size,
    roads,
    buildings,
  };
}
