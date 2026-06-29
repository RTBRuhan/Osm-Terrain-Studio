/**
 * Geodesy helpers for OSM Terrain Studio.
 *
 * Everything here is built around a *local tangent plane* (ENU – East/North/Up)
 * approximation centred on a reference latitude/longitude. Over the few-kilometre
 * extents this tool targets (e.g. a 5 km × 10 km game terrain) the linearised
 * conversion below is accurate to well under a metre, which is far tighter than
 * OSM's own positional accuracy.
 *
 * The "box" is a georeferenced rectangle that maps 1:1 onto a Unity terrain:
 *   - width  (metres) -> Unity local X axis (east when bearing = 0)
 *   - height (metres) -> Unity local Z axis (north when bearing = 0)
 *   - bearing (deg, clockwise from north) rotates the rectangle
 *   - terrain origin (0,0) is the box corner that is south-west when bearing = 0
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Terrain-local coordinates in metres (Unity X east, Z north, Y up = 0). */
export interface LocalXZ {
  x: number;
  z: number;
}

export interface Box {
  /** Geographic centre of the rectangle. */
  centerLat: number;
  centerLon: number;
  /** Size along the local X axis, in metres. */
  widthM: number;
  /** Size along the local Z axis, in metres. */
  heightM: number;
  /** Clockwise rotation from north, in degrees. */
  bearingDeg: number;
}

const DEG2RAD = Math.PI / 180;

/** Metres per degree of latitude at latitude `lat` (WGS84 series approximation). */
export function metersPerDegLat(lat: number): number {
  const f = lat * DEG2RAD;
  return (
    111132.92 -
    559.82 * Math.cos(2 * f) +
    1.175 * Math.cos(4 * f) -
    0.0023 * Math.cos(6 * f)
  );
}

/** Metres per degree of longitude at latitude `lat`. */
export function metersPerDegLon(lat: number): number {
  const f = lat * DEG2RAD;
  return (
    111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f)
  );
}

/**
 * A reusable converter between WGS84 lat/lon and terrain-local metres for a
 * given box. Build it once per box and reuse for every vertex – it caches the
 * trig and per-degree scale factors.
 */
export class BoxFrame {
  readonly box: Box;
  private readonly mPerLat: number;
  private readonly mPerLon: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(box: Box) {
    this.box = box;
    this.mPerLat = metersPerDegLat(box.centerLat);
    this.mPerLon = metersPerDegLon(box.centerLat);
    const b = box.bearingDeg * DEG2RAD;
    this.cos = Math.cos(b);
    this.sin = Math.sin(b);
  }

  /** lat/lon -> East/North metres relative to the box centre. */
  private toEN(lat: number, lon: number): { e: number; n: number } {
    return {
      e: (lon - this.box.centerLon) * this.mPerLon,
      n: (lat - this.box.centerLat) * this.mPerLat,
    };
  }

  private toLatLon(e: number, n: number): LatLon {
    return {
      lat: this.box.centerLat + n / this.mPerLat,
      lon: this.box.centerLon + e / this.mPerLon,
    };
  }

  /** lat/lon -> terrain-local metres (origin at SW corner, X east, Z north). */
  toLocal(lat: number, lon: number): LocalXZ {
    const { e, n } = this.toEN(lat, lon);
    // Rotate ENU into the box-aligned frame, then shift origin to the corner.
    const xb = e * this.cos - n * this.sin;
    const yb = e * this.sin + n * this.cos;
    return { x: xb + this.box.widthM / 2, z: yb + this.box.heightM / 2 };
  }

  /** terrain-local metres -> lat/lon. */
  toLatLonFromLocal(x: number, z: number): LatLon {
    const xb = x - this.box.widthM / 2;
    const yb = z - this.box.heightM / 2;
    const e = xb * this.cos + yb * this.sin;
    const n = -xb * this.sin + yb * this.cos;
    return this.toLatLon(e, n);
  }

  /** The four corners of the box as a closed ring of [lon, lat] (GeoJSON order). */
  cornerRing(): [number, number][] {
    const { widthM: w, heightM: h } = this.box;
    const corners: LocalXZ[] = [
      { x: 0, z: 0 },
      { x: w, z: 0 },
      { x: w, z: h },
      { x: 0, z: h },
    ];
    const ring = corners.map((c) => {
      const ll = this.toLatLonFromLocal(c.x, c.z);
      return [ll.lon, ll.lat] as [number, number];
    });
    ring.push(ring[0]);
    return ring;
  }
}

/** Great-circle-ish distance in metres between two points (local-plane accurate). */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const midLat = (a.lat + b.lat) / 2;
  const de = (b.lon - a.lon) * metersPerDegLon(midLat);
  const dn = (b.lat - a.lat) * metersPerDegLat(midLat);
  return Math.hypot(de, dn);
}

/** Initial bearing (deg clockwise from north) from `a` to `b`. */
export function bearingBetween(a: LatLon, b: LatLon): number {
  const midLat = (a.lat + b.lat) / 2;
  const de = (b.lon - a.lon) * metersPerDegLon(midLat);
  const dn = (b.lat - a.lat) * metersPerDegLat(midLat);
  let deg = Math.atan2(de, dn) / DEG2RAD;
  if (deg < 0) deg += 360;
  return deg;
}

/** Move a point by east/north metres, returning a new lat/lon. */
export function offsetMeters(p: LatLon, east: number, north: number): LatLon {
  return {
    lat: p.lat + north / metersPerDegLat(p.lat),
    lon: p.lon + east / metersPerDegLon(p.lat),
  };
}

// ---------------------------------------------------------------------------
// Clipping in terrain-local space (axis-aligned rectangle [0,W] x [0,H]).
// Because the box frame already rotates everything, clipping is a simple
// rectangle clip in local metres – no rotated-polygon math required.
// ---------------------------------------------------------------------------

export interface Rect {
  w: number;
  h: number;
}

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const BOTTOM = 4;
const TOP = 8;

function outCode(x: number, z: number, r: Rect): number {
  let code = INSIDE;
  if (x < 0) code |= LEFT;
  else if (x > r.w) code |= RIGHT;
  if (z < 0) code |= BOTTOM;
  else if (z > r.h) code |= TOP;
  return code;
}

export function pointInRect(p: LocalXZ, r: Rect): boolean {
  return p.x >= 0 && p.x <= r.w && p.z >= 0 && p.z <= r.h;
}

/**
 * Cohen–Sutherland clip of a single segment to the rectangle.
 * Returns the clipped segment or null if fully outside.
 */
function clipSegment(
  a: LocalXZ,
  b: LocalXZ,
  r: Rect,
): [LocalXZ, LocalXZ] | null {
  let x0 = a.x;
  let z0 = a.z;
  let x1 = b.x;
  let z1 = b.z;
  let c0 = outCode(x0, z0, r);
  let c1 = outCode(x1, z1, r);

  for (;;) {
    if (!(c0 | c1)) return [{ x: x0, z: z0 }, { x: x1, z: z1 }];
    if (c0 & c1) return null;
    const outside = c0 || c1;
    let x = 0;
    let z = 0;
    if (outside & TOP) {
      x = x0 + ((x1 - x0) * (r.h - z0)) / (z1 - z0);
      z = r.h;
    } else if (outside & BOTTOM) {
      x = x0 + ((x1 - x0) * (0 - z0)) / (z1 - z0);
      z = 0;
    } else if (outside & RIGHT) {
      z = z0 + ((z1 - z0) * (r.w - x0)) / (x1 - x0);
      x = r.w;
    } else {
      // LEFT
      z = z0 + ((z1 - z0) * (0 - x0)) / (x1 - x0);
      x = 0;
    }
    if (outside === c0) {
      x0 = x;
      z0 = z;
      c0 = outCode(x0, z0, r);
    } else {
      x1 = x;
      z1 = z;
      c1 = outCode(x1, z1, r);
    }
  }
}

/**
 * Clip a polyline to the rectangle, returning a list of contiguous sub-polylines
 * that lie inside. A road that leaves and re-enters the box yields multiple
 * pieces, which is exactly what you want when fitting roads to a terrain tile.
 */
export function clipPolyline(points: LocalXZ[], r: Rect): LocalXZ[][] {
  const out: LocalXZ[][] = [];
  let current: LocalXZ[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = clipSegment(points[i], points[i + 1], r);
    if (!seg) {
      if (current.length) {
        out.push(current);
        current = [];
      }
      continue;
    }
    const [s, e] = seg;
    if (current.length === 0) {
      current.push(s, e);
    } else {
      const last = current[current.length - 1];
      if (Math.abs(last.x - s.x) > 1e-6 || Math.abs(last.z - s.z) > 1e-6) {
        // The previous segment was clipped at the boundary -> start a new piece.
        out.push(current);
        current = [s, e];
      } else {
        current.push(e);
      }
    }
  }
  if (current.length) out.push(current);
  return out;
}

/** Sutherland–Hodgman polygon clip to the rectangle (for areas like buildings). */
export function clipPolygon(points: LocalXZ[], r: Rect): LocalXZ[] {
  const clipEdges: ((p: LocalXZ) => boolean)[] = [
    (p) => p.x >= 0,
    (p) => p.x <= r.w,
    (p) => p.z >= 0,
    (p) => p.z <= r.h,
  ];
  const intersectors: ((a: LocalXZ, b: LocalXZ) => LocalXZ)[] = [
    (a, b) => ({ x: 0, z: a.z + ((b.z - a.z) * (0 - a.x)) / (b.x - a.x) }),
    (a, b) => ({ x: r.w, z: a.z + ((b.z - a.z) * (r.w - a.x)) / (b.x - a.x) }),
    (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.z)) / (b.z - a.z), z: 0 }),
    (a, b) => ({ x: a.x + ((b.x - a.x) * (r.h - a.z)) / (b.z - a.z), z: r.h }),
  ];

  let output = points.slice();
  for (let e = 0; e < 4; e++) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    const inside = clipEdges[e];
    const intersect = intersectors[e];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output;
}

export function formatMeters(m: number): string {
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(3)} km`;
  return `${m.toFixed(1)} m`;
}

export function formatArea(m2: number): string {
  const km2 = m2 / 1e6;
  if (km2 >= 0.01) return `${km2.toFixed(3)} km²`;
  return `${Math.round(m2).toLocaleString()} m²`;
}
