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
  distanceMeters,
  formatMeters,
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

function measureFeatureCollection(
  points: LatLon[],
  cursor?: LatLon | null,
): GeoJSONFeatureCollection {
  const all = cursor ? [...points, cursor] : points;
  const features: GeoJSONFeatureCollection["features"] = [];
  if (all.length >= 2) {
    features.push({
      type: "Feature",
      properties: {} as never,
      geometry: {
        type: "LineString",
        coordinates: all.map((p) => [p.lon, p.lat] as [number, number]),
      },
    } as never);
  }
  for (const p of points) {
    features.push({
      type: "Feature",
      properties: {} as never,
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    } as never);
  }
  return { type: "FeatureCollection", features };
}

function freeFeatureCollection(
  ring: LatLon[] | null,
  closed = true,
): GeoJSONFeatureCollection {
  if (!ring || ring.length < 2) return EMPTY_FC;
  const coords = ring.map((p) => [p.lon, p.lat] as [number, number]);
  if (closed && coords.length >= 3) coords.push(coords[0]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {} as never,
        geometry:
          closed && coords.length >= 4
            ? { type: "Polygon", coordinates: [coords] }
            : { type: "LineString", coordinates: coords },
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
    | { mode: "freedraw"; points: LatLon[] }
    | null
  >(null);
  const movedRef = useRef(false);
  const measureMarkerRef = useRef<maplibregl.Marker | null>(null);

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
    if (!map.getSource("free")) {
      map.addSource("free", {
        type: "geojson",
        data: freeFeatureCollection(useStore.getState().freehand),
      });
    }
    if (!map.getSource("measure")) {
      map.addSource("measure", {
        type: "geojson",
        data: measureFeatureCollection(useStore.getState().measure),
      });
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

    // freehand region
    if (!map.getLayer("free-fill")) {
      map.addLayer({
        id: "free-fill",
        type: "fill",
        source: "free",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.12 },
      });
    }
    if (!map.getLayer("free-outline")) {
      map.addLayer({
        id: "free-outline",
        type: "line",
        source: "free",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 1] },
      });
    }

    // measure
    if (!map.getLayer("measure-line")) {
      map.addLayer({
        id: "measure-line",
        type: "line",
        source: "measure",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#34d399", "line-width": 2.5, "line-dasharray": [2, 1] },
      });
    }
    if (!map.getLayer("measure-pts")) {
      map.addLayer({
        id: "measure-pts",
        type: "circle",
        source: "measure",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#34d399",
          "circle-stroke-color": "#0f1419",
          "circle-stroke-width": 2,
        },
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
    (map.getSource("free") as GeoJSONSource | undefined)?.setData(
      freeFeatureCollection(state.freehand) as never,
    );
    (map.getSource("measure") as GeoJSONSource | undefined)?.setData(
      measureFeatureCollection(state.measure) as never,
    );
    updateMeasureMarker(map, state.measure);
    updateBoxVisibility(map, state.boxVisible);
    syncSelection(map);
  }

  function updateMeasureMarker(map: maplibregl.Map, points: LatLon[]) {
    if (points.length < 2) {
      measureMarkerRef.current?.remove();
      measureMarkerRef.current = null;
      return;
    }
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += distanceMeters(points[i - 1], points[i]);
    }
    const last = points[points.length - 1];
    if (!measureMarkerRef.current) {
      const el = document.createElement("div");
      el.className =
        "rounded-md border border-emerald-500/50 bg-panel-2/95 px-2 py-0.5 font-mono text-[11px] text-emerald-200 shadow-lg";
      measureMarkerRef.current = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
        offset: [0, -8],
      })
        .setLngLat([last.lon, last.lat])
        .addTo(map);
    }
    const el = measureMarkerRef.current.getElement();
    el.textContent = formatMeters(total);
    measureMarkerRef.current.setLngLat([last.lon, last.lat]);
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

  /**
   * queryRenderedFeatures throws if any requested layer id is missing, which
   * happens in the brief window after a basemap style reload before overlays
   * are re-added. Filter to layers that currently exist.
   */
  function queryLayers(
    map: maplibregl.Map,
    point: MapMouseEvent["point"],
    layers: string[],
  ) {
    const existing = layers.filter((l) => map.getLayer(l));
    if (existing.length === 0) return [];
    return map.queryRenderedFeatures(point, { layers: existing });
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

    if (state.tool === "freedraw") {
      e.preventDefault();
      map.dragPan.disable();
      dragRef.current = { mode: "freedraw", points: [lngLatToLatLon(e)] };
      return;
    }

    // In measure mode, clicks add points and drags pan the map normally.
    if (state.tool === "measure") return;

    if (state.boxVisible) {
      const rotateHit = queryLayers(map, e.point, ["box-rotate-handle"]);
      if (rotateHit.length) {
        e.preventDefault();
        map.dragPan.disable();
        dragRef.current = { mode: "rotate" };
        return;
      }
    }

    // dragging a selected node
    if (state.selection?.el === "node") {
      const nodeHit = queryLayers(map, e.point, ["sel-point"]);
      if (nodeHit.length) {
        e.preventDefault();
        map.dragPan.disable();
        dragRef.current = { mode: "node", id: state.selection.fid };
        return;
      }
    }

    if (state.boxVisible) {
      const moveHit = queryLayers(map, e.point, ["box-fill"]);
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
      if (tool === "draw" || tool === "freedraw") {
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      if (tool === "measure") {
        map.getCanvas().style.cursor = "crosshair";
        const pts = useStore.getState().measure;
        if (pts.length > 0) {
          (map.getSource("measure") as GeoJSONSource | undefined)?.setData(
            measureFeatureCollection(pts, lngLatToLatLon(e)) as never,
          );
        }
        return;
      }
      const hit = queryLayers(map, e.point, [
        "box-rotate-handle",
        "box-fill",
        ...DATA_LAYERS,
      ]);
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
      case "freedraw": {
        const last = drag.points[drag.points.length - 1];
        // thin the path so we don't store thousands of near-identical points
        if (
          !last ||
          Math.abs(last.lat - cur.lat) > 1e-6 ||
          Math.abs(last.lon - cur.lon) > 1e-6
        ) {
          drag.points.push(cur);
        }
        (map.getSource("free") as GeoJSONSource).setData(
          freeFeatureCollection(drag.points, false) as never,
        );
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
    } else if (drag?.mode === "freedraw") {
      if (drag.points.length >= 3) {
        useStore.getState().setFreehand(drag.points);
        useStore.getState().setTool("pan");
      } else {
        // too small – discard and restore committed region
        (map.getSource("free") as GeoJSONSource).setData(
          freeFeatureCollection(useStore.getState().freehand) as never,
        );
      }
    }
    dragRef.current = null;
    map.dragPan.enable();
  }

  function onClick(map: maplibregl.Map, e: MapMouseEvent) {
    if (movedRef.current) return;
    const tool = useStore.getState().tool;
    if (tool === "draw" || tool === "freedraw") return;
    if (tool === "measure") {
      useStore.getState().addMeasurePoint(lngLatToLatLon(e));
      return;
    }
    const hits = queryLayers(map, e.point, DATA_LAYERS);
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
      center: [state.view.lng, state.view.lat],
      zoom: state.view.zoom,
      bearing: state.view.bearing,
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
    const syncView = () => {
      const c = map.getCenter();
      useStore.getState().setView({
        lng: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
      });
    };
    map.on("rotate", () => onBearingChange(map.getBearing()));
    map.on("move", syncView);
    map.on("moveend", syncView);
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

  // measure updates
  const measure = useStore((s) => s.measure);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("measure") as GeoJSONSource | undefined)?.setData(
      measureFeatureCollection(measure) as never,
    );
    updateMeasureMarker(map, measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure]);

  // view commands (numeric inputs / search / permalink)
  const viewCommand = useStore((s) => s.viewCommand);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !viewCommand) return;
    const v = viewCommand.view;
    map.easeTo({
      center:
        v.lng != null && v.lat != null
          ? [v.lng, v.lat]
          : v.lat != null || v.lng != null
            ? [v.lng ?? map.getCenter().lng, v.lat ?? map.getCenter().lat]
            : map.getCenter(),
      zoom: v.zoom ?? map.getZoom(),
      bearing: v.bearing ?? map.getBearing(),
      duration: 500,
    });
  }, [viewCommand]);

  // freehand region updates
  const freehand = useStore((s) => s.freehand);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("free") as GeoJSONSource | undefined)?.setData(
      freeFeatureCollection(freehand) as never,
    );
  }, [freehand]);

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
    map.getCanvas().style.cursor =
      tool === "draw" || tool === "freedraw" ? "crosshair" : "";
  }, [tool]);

  return <div ref={containerRef} className="absolute inset-0" />;
});

export default MapView;
