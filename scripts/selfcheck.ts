/**
 * Headless sanity checks for the geometry + export pipeline.
 * Run with:  npx tsx scripts/selfcheck.ts
 */
import { BoxFrame, distanceMeters, type Box, type LatLon } from "../src/lib/geo";
import { emptyOsm, type OsmData } from "../src/lib/osm";
import { clipOsmToBox, clipOsmToPolygon } from "../src/lib/exports";

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`, extra ?? "");
  }
}
function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

const box: Box = {
  centerLat: 51.5,
  centerLon: -0.12,
  widthM: 5000,
  heightM: 10000,
  bearingDeg: 0,
};

// --- 1. Local frame round-trips and corner placement ----------------------
const frame = new BoxFrame(box);
const center = frame.toLocal(box.centerLat, box.centerLon);
assert(
  "center maps to (W/2, H/2)",
  approx(center.x, 2500, 0.01) && approx(center.z, 5000, 0.01),
  center,
);

const origin = frame.toLatLonFromLocal(0, 0);
const originLocal = frame.toLocal(origin.lat, origin.lon);
assert(
  "origin corner round-trips to (0,0)",
  approx(originLocal.x, 0, 0.001) && approx(originLocal.z, 0, 0.001),
  originLocal,
);

// distance origin->opposite corner should equal the diagonal
const opposite = frame.toLatLonFromLocal(box.widthM, box.heightM);
const diag = distanceMeters(origin, opposite);
assert(
  "diagonal length matches sqrt(W^2+H^2)",
  approx(diag, Math.hypot(5000, 10000), 5),
  diag,
);

// --- 2. Bearing rotation keeps the box size constant ----------------------
const rotated = new BoxFrame({ ...box, bearingDeg: 37 });
const rOrigin = rotated.toLatLonFromLocal(0, 0);
const rWidthCorner = rotated.toLatLonFromLocal(box.widthM, 0);
const rHeightCorner = rotated.toLatLonFromLocal(0, box.heightM);
// Tangent-plane projections distort by ~0.05% at multi-km offsets from the
// reference point; allow up to 0.1% which is well below OSM positional accuracy.
assert(
  "rotated width edge == widthM (<=0.1%)",
  approx(distanceMeters(rOrigin, rWidthCorner), 5000, 5),
  distanceMeters(rOrigin, rWidthCorner),
);
assert(
  "rotated height edge == heightM (<=0.1%)",
  approx(distanceMeters(rOrigin, rHeightCorner), 10000, 10),
  distanceMeters(rOrigin, rHeightCorner),
);

// --- 3. Clipping a road that exits the box --------------------------------
// Build a tiny dataset: one straight E-W road through the centre that extends
// well beyond the box on both sides, plus a node fully outside.
function makeData(): OsmData {
  const data = emptyOsm();
  // A west point far outside (x ~ -5000) and east point far outside (x ~ +10000)
  const west = frame.toLatLonFromLocal(-5000, 5000);
  const mid = frame.toLatLonFromLocal(2500, 5000);
  const east = frame.toLatLonFromLocal(10000, 5000);
  data.nodes.set("1", { id: "1", lat: west.lat, lon: west.lon, tags: {} });
  data.nodes.set("3", { id: "3", lat: mid.lat, lon: mid.lon, tags: {} });
  data.nodes.set("2", { id: "2", lat: east.lat, lon: east.lon, tags: {} });
  data.ways.set("10", {
    id: "10",
    refs: ["1", "3", "2"],
    tags: { highway: "primary", name: "Test Road", lanes: "2" },
  });
  return data;
}

const data = makeData();
const { clipped, frame: clipFrame } = clipOsmToBox(data, box);
// All clipped nodes must be inside [0,W] x [0,H]
let allInside = true;
for (const n of clipped.nodes.values()) {
  const p = clipFrame.toLocal(n.lat, n.lon);
  if (p.x < -0.5 || p.x > box.widthM + 0.5 || p.z < -0.5 || p.z > box.heightM + 0.5) {
    allInside = false;
    console.error("    out-of-box node", p);
  }
}
assert("clipped road nodes lie within terrain bounds", allInside);

// The clipped road should span the full width (0..5000) of the box.
const clippedWay = [...clipped.ways.values()][0];
const xsLocal = clippedWay.refs
  .map((r) => clipped.nodes.get(r))
  .filter((n): n is NonNullable<typeof n> => Boolean(n))
  .map((n) => clipFrame.toLocal(n.lat, n.lon).x);
assert(
  "clipped road spans the full 5000 m width",
  approx(Math.min(...xsLocal), 0, 1) && approx(Math.max(...xsLocal), 5000, 1),
  xsLocal,
);
assert("box bounds carried into clip", clipped.bounds != null);

// --- 4. Freehand polygon clip ---------------------------------------------
// A small triangle near the centre should keep the road (it passes through).
const c = { lat: box.centerLat, lon: box.centerLon };
const tri: LatLon[] = [
  frame.toLatLonFromLocal(2000, 4000),
  frame.toLatLonFromLocal(3000, 4000),
  frame.toLatLonFromLocal(2500, 6000),
];
void c;
const region = clipOsmToPolygon(data, tri);
assert("freehand region keeps the intersecting road", region.ways.size === 1, region.ways.size);
// A region far away should keep nothing.
const farTri: LatLon[] = [
  frame.toLatLonFromLocal(-50000, -50000),
  frame.toLatLonFromLocal(-49000, -50000),
  frame.toLatLonFromLocal(-49500, -49000),
];
assert("freehand region far away keeps nothing", clipOsmToPolygon(data, farTri).ways.size === 0);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("All self-checks passed.");
}
