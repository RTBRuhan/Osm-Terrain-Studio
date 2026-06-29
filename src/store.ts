import { create } from "zustand";
import {
  computeBounds,
  computeStats,
  osmToGeoJSON,
  parseOsmXml,
  type GeoJSONFeatureCollection,
  type OsmBounds,
  type OsmData,
  type OsmStats,
  type Tags,
} from "./lib/osm";
import type { Box } from "./lib/geo";
import { metersPerDegLat, metersPerDegLon } from "./lib/geo";
import type { BasemapId } from "./lib/basemaps";
import { bboxAreaKm2, fetchOverpassBbox } from "./lib/overpass";
import { BoxFrame } from "./lib/geo";

export type Tool = "pan" | "draw";

export interface StatusState {
  kind: "idle" | "loading" | "error" | "info";
  message?: string;
}

export interface Selection {
  fid: string;
  el: "way" | "node";
}

export interface FocusCommand {
  bounds: OsmBounds;
  nonce: number;
}

interface AppState {
  data: OsmData | null;
  geojson: GeoJSONFeatureCollection | null;
  stats: OsmStats | null;
  dataVersion: number;
  fileName: string | null;

  basemap: BasemapId;
  tool: Tool;
  box: Box;
  boxVisible: boolean;

  selection: Selection | null;
  status: StatusState;
  focus: FocusCommand | null;

  // data
  loadOsmText: (text: string, name: string) => void;
  loadFromOverpass: () => Promise<void>;
  clearData: () => void;

  // view / tools
  setBasemap: (id: BasemapId) => void;
  setTool: (tool: Tool) => void;
  setStatus: (status: StatusState) => void;

  // box
  setBox: (box: Box) => void;
  updateBox: (partial: Partial<Box>) => void;
  setBoxFromCorners: (
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ) => void;
  setBoxVisible: (visible: boolean) => void;
  fitBoxToData: () => void;
  focusOnBox: () => void;

  // selection / editing
  select: (sel: Selection | null) => void;
  updateSelectedTags: (tags: Tags) => void;
  deleteSelected: () => void;
  moveNode: (id: string, lat: number, lon: number) => void;
}

const DEFAULT_BOX: Box = {
  centerLat: 51.5074,
  centerLon: -0.1278,
  widthM: 5000,
  heightM: 5000,
  bearingDeg: 0,
};

function recompute(data: OsmData): {
  geojson: GeoJSONFeatureCollection;
  stats: OsmStats;
} {
  return { geojson: osmToGeoJSON(data), stats: computeStats(data) };
}

function boundsCenter(b: OsmBounds): { lat: number; lon: number } {
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
}

export const useStore = create<AppState>((set, get) => ({
  data: null,
  geojson: null,
  stats: null,
  dataVersion: 0,
  fileName: null,

  basemap: "dark",
  tool: "pan",
  box: DEFAULT_BOX,
  boxVisible: true,
  selection: null,
  status: { kind: "idle" },
  focus: null,

  loadOsmText: (text, name) => {
    try {
      const data = parseOsmXml(text);
      const { geojson, stats } = recompute(data);
      const bounds = data.bounds ?? computeBounds(data);
      const center = bounds ? boundsCenter(bounds) : null;
      set((s) => ({
        data,
        geojson,
        stats,
        fileName: name,
        dataVersion: s.dataVersion + 1,
        selection: null,
        box: center
          ? { ...s.box, centerLat: center.lat, centerLon: center.lon }
          : s.box,
        focus: bounds ? { bounds, nonce: Date.now() } : s.focus,
        status: {
          kind: "info",
          message: `Loaded ${stats.nodes.toLocaleString()} nodes, ${stats.ways.toLocaleString()} ways`,
        },
      }));
    } catch (err) {
      set({
        status: {
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load file.",
        },
      });
    }
  },

  loadFromOverpass: async () => {
    const { box } = get();
    const frame = new BoxFrame(box);
    const ring = frame.cornerRing();
    let minLat = Infinity;
    let minLon = Infinity;
    let maxLat = -Infinity;
    let maxLon = -Infinity;
    for (const [lon, lat] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
    const bounds: OsmBounds = { minLat, minLon, maxLat, maxLon };
    const area = bboxAreaKm2(bounds);
    if (area > 120) {
      set({
        status: {
          kind: "error",
          message: `Box area ~${area.toFixed(0)} km² is too large for Overpass. Try ≤ 120 km² or upload an .osm file.`,
        },
      });
      return;
    }
    set({ status: { kind: "loading", message: "Fetching from Overpass…" } });
    try {
      const { xml } = await fetchOverpassBbox(bounds);
      get().loadOsmText(xml, "overpass-download.osm");
    } catch (err) {
      set({
        status: {
          kind: "error",
          message:
            err instanceof Error
              ? `Overpass error: ${err.message}`
              : "Overpass request failed.",
        },
      });
    }
  },

  clearData: () =>
    set((s) => ({
      data: null,
      geojson: null,
      stats: null,
      fileName: null,
      selection: null,
      dataVersion: s.dataVersion + 1,
      status: { kind: "idle" },
    })),

  setBasemap: (id) => set({ basemap: id }),
  setTool: (tool) => set({ tool }),
  setStatus: (status) => set({ status }),

  setBox: (box) => set({ box }),
  updateBox: (partial) => set((s) => ({ box: { ...s.box, ...partial } })),

  setBoxFromCorners: (a, b) => {
    const centerLat = (a.lat + b.lat) / 2;
    const centerLon = (a.lon + b.lon) / 2;
    const widthM =
      Math.abs(b.lon - a.lon) * metersPerDegLon(centerLat);
    const heightM =
      Math.abs(b.lat - a.lat) * metersPerDegLat(centerLat);
    set((s) => ({
      box: {
        ...s.box,
        centerLat,
        centerLon,
        widthM: Math.max(widthM, 10),
        heightM: Math.max(heightM, 10),
        bearingDeg: 0,
      },
      tool: "pan",
    }));
  },

  setBoxVisible: (visible) => set({ boxVisible: visible }),

  fitBoxToData: () => {
    const { data } = get();
    const bounds = data?.bounds ?? (data ? computeBounds(data) : null);
    if (!bounds) return;
    const center = boundsCenter(bounds);
    const widthM =
      (bounds.maxLon - bounds.minLon) * metersPerDegLon(center.lat) * 0.95;
    const heightM =
      (bounds.maxLat - bounds.minLat) * metersPerDegLat(center.lat) * 0.95;
    set((s) => ({
      box: {
        ...s.box,
        centerLat: center.lat,
        centerLon: center.lon,
        widthM: Math.max(widthM, 50),
        heightM: Math.max(heightM, 50),
        bearingDeg: 0,
      },
    }));
  },

  focusOnBox: () => {
    const { box } = get();
    const frame = new BoxFrame(box);
    const ring = frame.cornerRing();
    let minLat = Infinity;
    let minLon = Infinity;
    let maxLat = -Infinity;
    let maxLon = -Infinity;
    for (const [lon, lat] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
    set({ focus: { bounds: { minLat, minLon, maxLat, maxLon }, nonce: Date.now() } });
  },

  select: (sel) => set({ selection: sel }),

  updateSelectedTags: (tags) => {
    const { data, selection } = get();
    if (!data || !selection) return;
    const target =
      selection.el === "way"
        ? data.ways.get(selection.fid)
        : data.nodes.get(selection.fid);
    if (!target) return;
    target.tags = tags;
    const { geojson, stats } = recompute(data);
    set((s) => ({ geojson, stats, dataVersion: s.dataVersion + 1 }));
  },

  deleteSelected: () => {
    const { data, selection } = get();
    if (!data || !selection) return;
    if (selection.el === "way") {
      data.ways.delete(selection.fid);
    } else {
      data.nodes.delete(selection.fid);
      for (const way of data.ways.values()) {
        if (way.refs.includes(selection.fid)) {
          way.refs = way.refs.filter((r) => r !== selection.fid);
        }
      }
    }
    const { geojson, stats } = recompute(data);
    set((s) => ({
      geojson,
      stats,
      selection: null,
      dataVersion: s.dataVersion + 1,
    }));
  },

  moveNode: (id, lat, lon) => {
    const { data } = get();
    if (!data) return;
    const node = data.nodes.get(id);
    if (!node) return;
    node.lat = lat;
    node.lon = lon;
    const { geojson, stats } = recompute(data);
    set((s) => ({ geojson, stats, dataVersion: s.dataVersion + 1 }));
  },
}));
