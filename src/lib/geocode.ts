/**
 * Place search via the OpenStreetMap Nominatim geocoder.
 * Nominatim's usage policy asks for low request rates and identification; we
 * debounce in the UI and only fire on submit / explicit typing pauses.
 */
export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  /** [minLat, maxLat, minLon, maxLon] when provided. */
  boundingbox?: [number, number, number, number];
  type?: string;
}

export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=6&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    type?: string;
    boundingbox?: [string, string, string, string];
  }>;
  return data.map((d) => ({
    displayName: d.display_name,
    lat: Number(d.lat),
    lon: Number(d.lon),
    type: d.type,
    boundingbox: d.boundingbox
      ? [
          Number(d.boundingbox[0]),
          Number(d.boundingbox[1]),
          Number(d.boundingbox[2]),
          Number(d.boundingbox[3]),
        ]
      : undefined,
  }));
}
