import type { StyleSpecification } from "maplibre-gl";

export type BasemapId = "dark" | "light" | "streets" | "satellite";

interface RasterBasemap {
  id: BasemapId;
  label: string;
  tiles: string[];
  attribution: string;
  maxzoom: number;
}

export const BASEMAPS: Record<BasemapId, RasterBasemap> = {
  dark: {
    id: "dark",
    label: "Dark",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
    maxzoom: 20,
  },
  light: {
    id: "light",
    label: "Light",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ],
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
    maxzoom: 20,
  },
  streets: {
    id: "streets",
    label: "Streets",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxzoom: 19,
  },
  satellite: {
    id: "satellite",
    label: "Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution:
      "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxzoom: 19,
  },
};

export function basemapStyle(id: BasemapId): StyleSpecification {
  const bm = BASEMAPS[id];
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: bm.tiles,
        tileSize: 256,
        attribution: bm.attribution,
        maxzoom: bm.maxzoom,
      },
    },
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-opacity": 1 },
      },
    ],
  };
}
