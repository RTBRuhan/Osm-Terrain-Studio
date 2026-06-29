import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import maplibregl, {
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import { useStore } from "../store";
import { basemapStyle } from "../lib/basemaps";
import {
  BoxFrame,
  bearingBetween,
  type Box,
  type LatLon,
} from "../lib/geo";
import type { GeoJSONFeatureCollection } from "../lib/osm";

export interface MapHandle {
  setBearing: (deg: number) => void;
  resetNorth: () => void;
}

interface MapViewProps {
  onBearingChange: (deg: number) => void;
}

const DATA_LAYERS = ["osm-fill", "osm-line", "osm-poi"];

const EMPTY_FC: GeoJSONFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function boxFeatureCollection(box: Box): GeoJSONFeatureCollection {
  const frame = new BoxFrame(box);
  const ring = frame.cornerRing();
  return {
    type: "FeatureCollection",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features: [
      {
        type: "Feature",
        properties: {} as never,
        geometry: { type: "Polygon", coordinates: [ring] },
      } as never,
    ],
  };
}

function handlesFeatureCollection(box: Box) {
  const frame = new BoxFrame(box);
  const origin = frame.toLatLonFromLocal(0, 0);
  const center = { lat: box.centerLat, lon: box.centerLon };
  // Rotate handle sits just beyond the "north" (height) edge of the box,
  // centred along the width, pointing in the box bearing direction.
  const handleZ = box.heightM + Math.max(box.heightM * 0.08, 40);
  const handle = frame.toLatLonFromLocal(box.widthM / 2, handleZ);
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { role: "stem" },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [center.lon, center.lat],
            [handle.lon, handle.lat],
          ],
        },
      },
      {
        type: "Feature" as const,
        properties: { role: "origin" },
        geometry: { type: "Point" as const, coordinates: [origin.lon, origin.lat] },
      },
      {
        type: "Feature" as const,
        properties: { role: "rotate" },
        geometry: { type: "Point" as const, coordinates: [handle.lon, handle.lat] },
      },
    ],
  };
}

const MapView = forwardRef<MapHandle, MapViewProps>(function MapView(
  { onBearingChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const dragRef = useRef<
    | { mode: "move"; startLngLat: LatLon; startBox: Box }
    | { mode: "rotate" }
    | { mode: "node"; id: string }
    | { mode: "draw"; start: LatLon }
    | null
  >(null);
  const movedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    setBearing: (deg) => mapRef.current?.setBearing(deg),
    resetNorth: () => mapRef.current?.rotateTo(0, { duration: 300 }),
  }));

  // ---- overlay setup -------------------------------------------------------
  function addOverlays(map: maplibregl.Map) {
    if (!map.getSource("osm-data")) {
      map.addSource("osm-data", { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getSource("selection")) {
      map.addSource("selection", { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getSource("box")) {
      map.addSource("box", {
        type: "geojson",
        data: boxFeatureCollection(useStore.getState().box),
      });
    }
    if (!map.getSource("box-handles")) {
      map.addSource("box-handles", {
        type: "geojson",
        data: handlesFeatureCollection(useStore.getState().box) as never,
      });
    }
    if (!map.getSource("draw-preview")) {
      map.addSource("draw-preview", { type: "geojson", data: EMPTY_FC });
    }

    const lineWidth = (mult: number): maplibregl.ExpressionSpecification =>
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["*", mult * 0.4, ["-", 8, ["get", "rank"]]],
        17,
        ["*", mult * 2.2, ["-", 8, ["get", "rank"]]],
      ] as maplibregl.ExpressionSpecification;

    const categoryColor: maplibregl.ExpressionSpecification = [
      "match",
      ["get", "category"],
      "road",
      "#f1f5f9",
      "path",
      "#a8a29e",
      "rail",
      "#cbd5e1",
      "waterway",
      "#38bdf8",
      "water",
      "#0ea5e9",
      "green",
      "#4ade80",
      "building",
      "#94a3b8",
      "#64748b",
    ] as maplibregl.ExpressionSpecification;

    const fillColor: maplibregl.ExpressionSpecification = [
      "match",
      ["get", "category"],
      "water",
      "#0c4a6e",
      "green",
      "#14532d",
      "building",
      "#475569",
      "#334155",
    ] as maplibregl.ExpressionSpecification;

    if (!map.getLayer("osm-fill")) {
      map.addLayer({
        id: "osm-fill",
        type: "fill",
        source: "osm-data",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": fillColor, "fill-opacity": 0.45 },
      });
    }
    if (!map.getLayer("osm-fill-outline")) {
      map.addLayer({
        id: "osm-fill-outline",
        type: "line",
        source: "osm-data",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": categoryColor, "line-width": 0.8, "line-opacity": 0.7 },
      });
    }
    if (!map.getLayer("osm-line")) {
      map.addLayer({
        id: "osm-line",
        type: "line",
        source: "osm-data",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": categoryColor,
          "line-width": lineWidth(1),
          "line-opacity": 0.95,
        },
      });
    }
    if (!map.getLayer("osm-poi")) {
      map.addLayer({
        id: "osm-poi",
        type: "circle",
        source: "osm-data",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 5],
          "circle-color": "#22d3ee",
          "circle-stroke-color": "#0f1419",
          "circle-stroke-width": 1,
        },
      });
    }

    // selection highlight
    if (!map.getLayer("sel-line")) {
      map.addLayer({
        id: "sel-line",
        type: "line",
        source: "selection",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fbbf24", "line-width": 4, "line-opacity": 0.9 },
      });
    }
    if (!map.getLayer("sel-point")) {
      map.addLayer({
        id: "sel-point",
        type: "circle",
        source: "selection",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#fbbf24",
          "circle-stroke-color": "#0f1419",
          "circle-stroke-width": 2,
        },
      });
    }

    // draw preview
    if (!map.getLayer("draw-fill")) {
      map.addLayer({
        id: "draw-fill",
        type: "fill",
        source: "draw-preview",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
      });
    }
    if (!map.getLayer("draw-outline")) {
      map.addLayer({
        id: "draw-outline",
        type: "line",
        source: "draw-preview",
        paint: { "line-color": "#38bdf8", "line-width": 1.5, "line-dasharray": [2, 2] },
      });
    }

    // box
    if (!map.getLayer("box-fill")) {
      map.addLayer({
        id: "box-fill",
        type: "fill",
        source: "box",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.1 },
      });
    }
    if (!map.getLayer("box-outline")) {
      map.addLayer({
        id: "box-outline",
        type: "line",
        source: "box",
        paint: { "line-color": "#38bdf8", "line-width": 2.5 },
      });
    }
    if (!map.getLayer("box-stem")) {
      map.addLayer({
        id: "box-stem",
        type: "line",
        source: "box-handles",
        filter: ["==", ["get", "role"], "stem"],
        paint: { "line-color": "#22d3ee", "line-width": 1.5, "line-dasharray": [2, 1] },
      });
    }
    if (!map.getLayer("box-origin")) {
      map.addLayer({
        id: "box-origin",
        type: "circle",
        source: "box-handles",
        filter: ["==", ["get", "role"], "origin"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#f97316",
          "circle-stroke-color": "#0f1419",
          "circle-stroke-width": 2,
        },
      });
    }
    if (!map.getLayer("box-rotate-handle")) {
      map.addLayer({
        id: "box-rotate-handle",
        type: "circle",
        source: "box-handles",
        filter: ["==", ["get", "role"], "rotate"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#22d3ee",
          "circle-stroke-color": "#0f1419",
          "circle-stroke-width": 2,
        },
      });
    }

    syncAll(map);
  }

  function syncAll(map: maplibregl.Map) {
    const state = useStore.getState();
    (map.getSource("osm-data") as GeoJSONSource | undefined)?.setData(
      (state.geojson ?? EMPTY_FC) as never,
    );
    (map.getSource("box") as GeoJSONSource | undefined)?.setData(
      boxFeatureCollection(state.box) as never,
    );
    (map.getSource("box-handles") as GeoJSONSource | undefined)?.setData(
      handlesFeatureCollection(state.box) as never,
    );
    updateBoxVisibility(map, state.boxVisible);
    syncSelection(map);
  }

  function updateBoxVisibility(map: maplibregl.Map, visible: boolean) {
    const v = visible ? "visible" : "none";
    for (const id of [
      "box-fill",
      "box-outline",
      "box-stem",
      "box-origin",
      "box-rotate-handle",
    ]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    }
  }

  function syncSelection(map: maplibregl.Map) {
    const { selection, geojson } = useStore.getState();
    const src = map.getSource("selection") as GeoJSONSource | undefined;
    if (!src) return;
    if (!selection || !geojson) {
      src.setData(EMPTY_FC as never);
      return;
    }
    const prefix = selection.el === "way" ? "w" : "n";
    const feat = geojson.features.find((f) => f.id === prefix + selection.fid);
    src.setData(
      feat
        ? ({ type: "FeatureCollection", features: [feat] } as never)
        : (EMPTY_FC as never),
    );
  }

  // ---- interactions --------------------------------------------------------
  function lngLatToLatLon(e: MapMouseEvent): LatLon {
    return { lat: e.lngLat.lat, lon: e.lngLat.lng };
  }

  function onMouseDown(map: maplibregl.Map, e: MapMouseEvent) {
    const state = useStore.getState();
    movedRef.current = false;

    if (state.tool === "draw") {
      e.preventDefault();
      map.dragPan.disable();
      dragRef.current = { mode: "draw", start: lngLatToLatLon(e) };
      return;
    }

    if (state.boxVisible) {
      const rotateHit = map.queryRenderedFeatures(e.point, {
        layers: ["box-rotate-handle"],
      });
      if (rotateHit.length) {
        e.preventDefault();
        map.dragPan.disable();
        dragRef.current = { mode: "rotate" };
        return;
      }
    }

    // dragging a selected node
    if (state.selection?.el === "node") {
      const nodeHit = map.queryRenderedFeatures(e.point, {
        layers: ["sel-point"],
      });
      if (nodeHit.length) {
        e.preventDefault();
        map.dragPan.disable();
        dragRef.current = { mode: "node", id: state.selection.fid };
        return;
      }
    }

    if (state.boxVisible) {
      const moveHit = map.queryRenderedFeatures(e.point, {
        layers: ["box-fill"],
      });
      if (moveHit.length) {
        e.preventDefault();
        map.dragPan.disable();
        dragRef.current = {
          mode: "move",
          startLngLat: lngLatToLatLon(e),
          startBox: state.box,
        };
        return;
      }
    }
  }

  function onMouseMove(map: maplibregl.Map, e: MapMouseEvent) {
    const drag = dragRef.current;
    if (!drag) {
      // hover cursor feedback
      const tool = useStore.getState().tool;
      if (tool === "draw") {
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, {
        layers: ["box-rotate-handle", "box-fill", ...DATA_LAYERS],
      });
      map.getCanvas().style.cursor = hit.length ? "pointer" : "";
      return;
    }
    movedRef.current = true;
    const cur = lngLatToLatLon(e);

    switch (drag.mode) {
      case "draw": {
        const fc: GeoJSONFeatureCollection = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {} as never,
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [drag.start.lon, drag.start.lat],
                    [cur.lon, drag.start.lat],
                    [cur.lon, cur.lat],
                    [drag.start.lon, cur.lat],
                    [drag.start.lon, drag.start.lat],
                  ],
                ],
              },
            } as never,
          ],
        };
        (map.getSource("draw-preview") as GeoJSONSource).setData(fc as never);
        break;
      }
      case "move": {
        const dLat = cur.lat - drag.startLngLat.lat;
        const dLon = cur.lon - drag.startLngLat.lon;
        useStore.getState().updateBox({
          centerLat: drag.startBox.centerLat + dLat,
          centerLon: drag.startBox.centerLon + dLon,
        });
        break;
      }
      case "rotate": {
        const box = useStore.getState().box;
        const bearing = bearingBetween(
          { lat: box.centerLat, lon: box.centerLon },
          cur,
        );
        useStore.getState().updateBox({ bearingDeg: Math.round(bearing * 10) / 10 });
        break;
      }
      case "node": {
        useStore.getState().moveNode(drag.id, cur.lat, cur.lon);
        break;
      }
      default: {
        const _exhaustive: never = drag;
        void _exhaustive;
      }
    }
  }

  function onMouseUp(map: maplibregl.Map, e: MapMouseEvent) {
    const drag = dragRef.current;
    if (drag?.mode === "draw") {
      const end = lngLatToLatLon(e);
      (map.getSource("draw-preview") as GeoJSONSource).setData(EMPTY_FC as never);
      if (
        Math.abs(end.lat - drag.start.lat) > 1e-6 &&
        Math.abs(end.lon - drag.start.lon) > 1e-6
      ) {
        useStore.getState().setBoxFromCorners(drag.start, end);
      }
    }
    dragRef.current = null;
    map.dragPan.enable();
  }

  function onClick(map: maplibregl.Map, e: MapMouseEvent) {
    if (movedRef.current) return;
    if (useStore.getState().tool === "draw") return;
    const hits = map.queryRenderedFeatures(e.point, { layers: DATA_LAYERS });
    if (!hits.length) {
      useStore.getState().select(null);
      return;
    }
    const f = hits[0];
    const props = f.properties as { fid?: string; el?: "way" | "node" } | null;
    if (props?.fid && props.el) {
      useStore.getState().select({ fid: props.fid, el: props.el });
    }
  }

  // ---- lifecycle -----------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const state = useStore.getState();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyle(state.basemap),
      center: [state.box.centerLon, state.box.centerLat],
      zoom: 11,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      addOverlays(map);
      readyRef.current = true;
    });
    map.on("rotate", () => onBearingChange(map.getBearing()));
    map.on("mousedown", (e) => onMouseDown(map, e));
    map.on("mousemove", (e) => onMouseMove(map, e));
    map.on("mouseup", (e) => onMouseUp(map, e));
    map.on("click", (e) => onClick(map, e));

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // basemap switch
  const basemap = useStore((s) => s.basemap);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(basemapStyle(basemap));
    map.once("style.load", () => addOverlays(map));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // data updates
  const geojson = useStore((s) => s.geojson);
  const dataVersion = useStore((s) => s.dataVersion);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osm-data") as GeoJSONSource | undefined)?.setData(
      (geojson ?? EMPTY_FC) as never,
    );
    syncSelection(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, dataVersion]);

  // box updates
  const box = useStore((s) => s.box);
  const boxVisible = useStore((s) => s.boxVisible);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("box") as GeoJSONSource | undefined)?.setData(
      boxFeatureCollection(box) as never,
    );
    (map.getSource("box-handles") as GeoJSONSource | undefined)?.setData(
      handlesFeatureCollection(box) as never,
    );
    updateBoxVisibility(map, boxVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, boxVisible]);

  // selection updates
  const selection = useStore((s) => s.selection);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncSelection(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // focus command
  const focus = useStore((s) => s.focus);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.fitBounds(
      [
        [focus.bounds.minLon, focus.bounds.minLat],
        [focus.bounds.maxLon, focus.bounds.maxLat],
      ],
      { padding: 80, duration: 800, maxZoom: 17 },
    );
  }, [focus]);

  // tool cursor
  const tool = useStore((s) => s.tool);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = tool === "draw" ? "crosshair" : "";
  }, [tool]);

  return <div ref={containerRef} className="absolute inset-0" />;
});

export default MapView;
