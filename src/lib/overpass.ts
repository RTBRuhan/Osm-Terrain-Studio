/**
 * Fetch raw OSM XML for a bounding box from the public Overpass API.
 * Used as a convenience so users can pull data for the current box area
 * without manually exporting from openstreetmap.org first.
 */
import type { OsmBounds } from "./osm";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export function buildOverpassQuery(b: OsmBounds): string {
  // Overpass bbox order is (south, west, north, east).
  const bbox = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
  return `[out:xml][timeout:90];
(
  node(${bbox});
  way(${bbox});
  relation(${bbox});
);
(._;>;);
out body;`;
}

export interface FetchResult {
  xml: string;
  endpoint: string;
}

/** Per-endpoint request timeout. Without this, a stalled mirror would hang the
 *  fetch indefinitely (the bug where it "kept loading"). */
const ENDPOINT_TIMEOUT_MS = 45_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function fetchOverpassBbox(
  b: OsmBounds,
  onProgress?: (msg: string) => void,
): Promise<FetchResult> {
  const query = buildOverpassQuery(b);
  let lastError: unknown = null;

  for (let i = 0; i < ENDPOINTS.length; i++) {
    const endpoint = ENDPOINTS[i];
    onProgress?.(
      `Fetching from ${hostOf(endpoint)} (${i + 1}/${ENDPOINTS.length})…`,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!res.ok) {
        // 429 / 504 are common when a mirror is busy – try the next one.
        lastError = new Error(`${hostOf(endpoint)} responded ${res.status}`);
        continue;
      }
      const xml = await res.text();
      if (!xml.includes("<osm")) {
        lastError = new Error(`Unexpected response from ${hostOf(endpoint)}.`);
        continue;
      }
      return { xml, endpoint };
    } catch (err) {
      lastError =
        err instanceof DOMException && err.name === "AbortError"
          ? new Error(`${hostOf(endpoint)} timed out`)
          : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Overpass endpoints failed.");
}

/** Rough vertex-count guard so we don't ask Overpass for absurd areas. */
export function bboxAreaKm2(b: OsmBounds): number {
  const midLat = ((b.minLat + b.maxLat) / 2) * (Math.PI / 180);
  const dLatKm = (b.maxLat - b.minLat) * 110.574;
  const dLonKm = (b.maxLon - b.minLon) * 111.32 * Math.cos(midLat);
  return Math.abs(dLatKm * dLonKm);
}
