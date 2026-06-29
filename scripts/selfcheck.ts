/**
 * Headless sanity checks for the geometry + export pipeline.
 * Run with:  npx tsx scripts/selfcheck.ts
 */
import { BoxFrame, distanceMeters, type Box } from "../src/lib/geo";
import { emptyOsm, type OsmData } from "../src/lib/osm";
import { buildUnityExport, clipOsmToBox } from "../src/lib/exports";

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
  const east = frame.toLatLonFromLocal(10000, 5000);
  data.nodes.set("1", { id: "1", lat: west.lat, lon: west.lon, tags: {} });
  data.nodes.set("2", { id: "2", lat: east.lat, lon: east.lon, tags: {} });
  data.ways.set("10", {
    id: "10",
    refs: ["1", "2"],
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

const unity = buildUnityExport(data, box, "roads");
assert("unity export has exactly one road", unity.roads.length === 1, unity.roads.length);
const road = unity.roads[0];
const xs = road.points.map((p) => p.x);
assert(
  "clipped road spans the full 5000 m width",
  approx(Math.min(...xs), 0, 1) && approx(Math.max(...xs), 5000, 1),
  xs,
);
assert("road width derived from lanes (2*3.5=7)", road.width === 7, road.width);
assert(
  "terrain size carried into export",
  unity.terrain.sizeXMeters === 5000 && unity.terrain.sizeZMeters === 10000,
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("All self-checks passed.");
}
