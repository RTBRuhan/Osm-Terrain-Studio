import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  distanceMeters,
  bearingBetween,
  formatArea,
  formatMeters,
  type Box,
} from "../lib/geo";
import { BASEMAPS, type BasemapId } from "../lib/basemaps";
import {
  buildClippedGeoJSON,
  buildClippedOsmXml,
  buildFullGeoJSON,
  buildFullOsmXml,
  buildLocalGeoJSON,
  buildRegionGeoJSON,
  buildRegionOsmXml,
  buildRoadCsv,
  downloadBlob,
  downloadText,
  type RoadFilter,
} from "../lib/exports";
import type { OsmData, Tags } from "../lib/osm";
import { geocode, type GeocodeResult } from "../lib/geocode";
import {
  elevToGray16,
  gray16ToPng,
  gray16ToRaw,
  maskGridToRing,
  rgbaToPngBlob,
  sampleBoxRGBA,
  sampleHeightmap,
  type HeightmapResult,
} from "../lib/tiles";
import {
  boxBBox,
  buildSceneSummary,
  buildTerrainReadme,
  encodeScene,
  googleMapsLink,
  osmLink,
  type SceneState,
} from "../lib/scene";
import { blobBytes, createZip, strBytes, type ZipEntry } from "../lib/zip";
import { NumberField, Section, Stat } from "./ui";

const BOX_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1 × 1", w: 1000, h: 1000 },
  { label: "2 × 2", w: 2000, h: 2000 },
  { label: "5 × 5", w: 5000, h: 5000 },
  { label: "5 × 10", w: 5000, h: 10000 },
  { label: "10 × 10", w: 10000, h: 10000 },
];

function fileBase(): string {
  return (useStore.getState().fileName ?? "osm-area")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-");
}

async function copyToClipboard(text: string) {
  const setStatus = useStore.getState().setStatus;
  try {
    await navigator.clipboard.writeText(text);
    setStatus({ kind: "info", message: "Copied to clipboard" });
  } catch {
    setStatus({ kind: "error", message: "Clipboard blocked by browser" });
  }
}

/* -------------------------------------------------------------------------- */

function SearchBox() {
  const commandView = useStore((s) => s.commandView);
  const updateBox = useStore((s) => s.updateBox);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const r = await geocode(q, ctrl.signal);
      setResults(r);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const pick = (r: GeocodeResult) => {
    let zoom = 13;
    if (r.boundingbox) {
      const [minLat, maxLat] = r.boundingbox;
      const span = Math.abs(maxLat - minLat);
      zoom = span > 1 ? 8 : span > 0.2 ? 10 : span > 0.05 ? 12 : 14;
    }
    commandView({ lat: r.lat, lng: r.lon, zoom });
    updateBox({ centerLat: r.lat, centerLon: r.lon });
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex gap-1.5">
        <input
          className="input"
          placeholder="Search a place, address, lat/lon…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button className="btn shrink-0" onClick={run} disabled={busy}>
          {busy ? "…" : "Go"}
        </button>
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-edge bg-panel-3 shadow-2xl scroll-thin">
          {results.map((r, i) => (
            <button
              key={i}
              className="block w-full border-b border-edge/50 px-3 py-2 text-left text-xs text-slate-300 last:border-0 hover:bg-panel"
              onClick={() => pick(r)}
            >
              <div className="truncate">{r.displayName}</div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
                {r.type ? ` · ${r.type}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DataSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const loadOsmText = useStore((s) => s.loadOsmText);
  const loadFromOverpass = useStore((s) => s.loadFromOverpass);
  const clearData = useStore((s) => s.clearData);
  const stats = useStore((s) => s.stats);
  const fileName = useStore((s) => s.fileName);
  const status = useStore((s) => s.status);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => loadOsmText(String(reader.result), file.name);
    reader.readAsText(file);
  };

  return (
    <Section
      title="Data & search"
      subtitle="Find a location, then upload an .osm file or pull the box area from OpenStreetMap."
    >
      <SearchBox />
      <input
        ref={fileRef}
        type="file"
        accept=".osm,.xml,application/xml,text/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
          Upload .osm
        </button>
        <button
          className="btn"
          onClick={() => loadFromOverpass()}
          disabled={status.kind === "loading"}
        >
          {status.kind === "loading" ? "Fetching…" : "Fetch box area"}
        </button>
      </div>

      {stats ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Nodes" value={stats.nodes.toLocaleString()} />
            <Stat label="Ways" value={stats.ways.toLocaleString()} />
            <Stat label="Roads" value={stats.roads.toLocaleString()} />
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate text-[11px] text-slate-500" title={fileName ?? ""}>
              {fileName}
            </span>
            <button className="btn btn-ghost text-xs" onClick={clearData}>
              Clear
            </button>
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed border-edge bg-panel/50 px-3 py-3 text-[11px] leading-relaxed text-slate-500">
          No data loaded. Tip: position the box first, then “Fetch box area” to
          download exactly what you need (≤ 120 km²).
        </p>
      )}
    </Section>
  );
}

function BoxSection() {
  const box = useStore((s) => s.box);
  const updateBox = useStore((s) => s.updateBox);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const boxVisible = useStore((s) => s.boxVisible);
  const setBoxVisible = useStore((s) => s.setBoxVisible);
  const fitBoxToData = useStore((s) => s.fitBoxToData);
  const focusOnBox = useStore((s) => s.focusOnBox);
  const hasData = useStore((s) => s.data != null);
  const freehand = useStore((s) => s.freehand);
  const setFreehand = useStore((s) => s.setFreehand);

  const scale = (factor: number) =>
    updateBox({
      widthM: Math.max(10, Math.round(box.widthM * factor)),
      heightM: Math.max(10, Math.round(box.heightM * factor)),
    });

  const setBearing = (v: number) =>
    updateBox({ bearingDeg: ((v % 360) + 360) % 360 });

  const area = box.widthM * box.heightM;
  const diagonal = Math.hypot(box.widthM, box.heightM);

  return (
    <Section
      title="Selection box"
      subtitle="A georeferenced rectangle you can size, move and rotate precisely."
      right={
        <button
          className={`btn btn-ghost text-xs ${boxVisible ? "text-accent" : "text-slate-500"}`}
          onClick={() => setBoxVisible(!boxVisible)}
        >
          {boxVisible ? "Visible" : "Hidden"}
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          className={`btn ${tool === "draw" ? "btn-primary" : ""}`}
          onClick={() => setTool(tool === "draw" ? "pan" : "draw")}
        >
          {tool === "draw" ? "Drawing…" : "Draw box"}
        </button>
        <button className="btn" onClick={focusOnBox}>
          Zoom to box
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          className={`btn ${
            tool === "freedraw"
              ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
              : ""
          }`}
          onClick={() => setTool(tool === "freedraw" ? "pan" : "freedraw")}
          title="Drag on the map to trace a freehand selection region"
        >
          {tool === "freedraw" ? "Tracing…" : "Free draw region"}
        </button>
        <button className="btn" onClick={() => setFreehand(null)} disabled={!freehand}>
          Clear region
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width (X)"
          value={Math.round(box.widthM) / 1000}
          step={0.1}
          min={0.01}
          suffix="km"
          onChange={(v) => updateBox({ widthM: Math.max(10, v * 1000) })}
        />
        <NumberField
          label="Height (Y)"
          value={Math.round(box.heightM) / 1000}
          step={0.1}
          min={0.01}
          suffix="km"
          onChange={(v) => updateBox({ heightM: Math.max(10, v * 1000) })}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {BOX_PRESETS.map((p) => (
          <button
            key={p.label}
            className="chip hover:border-accent/60"
            onClick={() => updateBox({ widthM: p.w, heightM: p.h })}
          >
            {p.label} km
          </button>
        ))}
        <button
          className="chip hover:border-accent/60"
          onClick={() => updateBox({ widthM: box.heightM, heightM: box.widthM })}
          title="Swap width and height"
        >
          ⇄ swap
        </button>
      </div>

      <div>
        <span className="field-label">Scale</span>
        <div className="mt-1 grid grid-cols-4 gap-1.5">
          <button className="btn text-xs" onClick={() => scale(0.5)}>
            ÷2
          </button>
          <button className="btn text-xs" onClick={() => scale(0.9)}>
            −10%
          </button>
          <button className="btn text-xs" onClick={() => scale(1.1)}>
            +10%
          </button>
          <button className="btn text-xs" onClick={() => scale(2)}>
            ×2
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between gap-2">
          <span className="field-label">Box rotation</span>
          <div className="w-24">
            <NumberField
              label=""
              value={Math.round(box.bearingDeg * 10) / 10}
              step={1}
              suffix="°"
              onChange={setBearing}
            />
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={360}
          step={0.5}
          value={box.bearingDeg}
          onChange={(e) => setBearing(parseFloat(e.target.value))}
          className="mt-2 w-full accent-accent"
        />
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          <button className="btn text-xs" onClick={() => setBearing(box.bearingDeg - 45)}>
            −45°
          </button>
          <button className="btn text-xs" onClick={() => setBearing(box.bearingDeg - 1)}>
            −1°
          </button>
          <button className="btn text-xs" onClick={() => setBearing(box.bearingDeg + 1)}>
            +1°
          </button>
          <button className="btn text-xs" onClick={() => setBearing(box.bearingDeg + 45)}>
            +45°
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Center lat"
          value={box.centerLat}
          step={0.0005}
          onChange={(v) => updateBox({ centerLat: v })}
        />
        <NumberField
          label="Center lon"
          value={box.centerLon}
          step={0.0005}
          onChange={(v) => updateBox({ centerLon: v })}
        />
      </div>

      <button
        className="btn w-full"
        onClick={fitBoxToData}
        disabled={!hasData}
        title={hasData ? "" : "Load data first"}
      >
        Fit box to loaded data
      </button>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Stat label="Area" value={formatArea(area)} />
        <Stat label="Diagonal" value={formatMeters(diagonal)} />
      </div>
    </Section>
  );
}

function MeasureSection() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const measure = useStore((s) => s.measure);
  const clearMeasure = useStore((s) => s.clearMeasure);

  const segments: { len: number; brg: number }[] = [];
  let total = 0;
  for (let i = 1; i < measure.length; i++) {
    const len = distanceMeters(measure[i - 1], measure[i]);
    const brg = bearingBetween(measure[i - 1], measure[i]);
    segments.push({ len, brg });
    total += len;
  }
  const straight =
    measure.length >= 2
      ? distanceMeters(measure[0], measure[measure.length - 1])
      : 0;

  return (
    <Section
      title="Measure"
      subtitle="Click points on the map to measure distance, bearing and scale."
      defaultOpen={false}
      badge={
        measure.length > 1 ? (
          <span className="chip border-emerald-500/40 text-emerald-300">
            {formatMeters(total)}
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          className={`btn ${tool === "measure" ? "btn-primary" : ""}`}
          onClick={() => setTool(tool === "measure" ? "pan" : "measure")}
        >
          {tool === "measure" ? "Measuring…" : "Measure tool"}
        </button>
        <button className="btn" onClick={clearMeasure} disabled={measure.length === 0}>
          Clear
        </button>
      </div>

      {measure.length >= 2 ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total path" value={formatMeters(total)} />
            <Stat label="Straight line" value={formatMeters(straight)} />
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-edge/70 scroll-thin">
            {segments.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-edge/40 px-2.5 py-1.5 text-xs last:border-0"
              >
                <span className="text-slate-500">seg {i + 1}</span>
                <span className="font-mono text-slate-200">{formatMeters(s.len)}</span>
                <span className="font-mono text-slate-500">{s.brg.toFixed(0)}°</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed border-edge bg-panel/50 px-3 py-2.5 text-[11px] text-slate-500">
          {tool === "measure"
            ? "Click points on the map. Press Esc or Clear to reset."
            : "Activate the measure tool, then click along anything to measure it."}
        </p>
      )}
    </Section>
  );
}

function EditSection() {
  const selection = useStore((s) => s.selection);
  const data = useStore((s) => s.data);
  const updateSelectedTags = useStore((s) => s.updateSelectedTags);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const moveNode = useStore((s) => s.moveNode);
  const select = useStore((s) => s.select);

  const [rows, setRows] = useState<{ k: string; v: string }[]>([]);

  const target =
    selection && data
      ? selection.el === "way"
        ? data.ways.get(selection.fid)
        : data.nodes.get(selection.fid)
      : null;

  useEffect(() => {
    if (target) setRows(Object.entries(target.tags).map(([k, v]) => ({ k, v })));
    else setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.fid, selection?.el]);

  if (!selection || !target) {
    return (
      <Section
        title="Edit"
        subtitle="Click a road, building, or point on the map to select and edit it."
        defaultOpen={false}
      >
        <p className="rounded-md border border-dashed border-edge bg-panel/50 px-3 py-3 text-[11px] text-slate-500">
          Nothing selected.
        </p>
      </Section>
    );
  }

  const commit = (next: { k: string; v: string }[]) => {
    setRows(next);
    const tags: Tags = {};
    for (const r of next) if (r.k.trim()) tags[r.k.trim()] = r.v;
    updateSelectedTags(tags);
  };

  const node = selection.el === "node" ? data?.nodes.get(selection.fid) : null;

  return (
    <Section
      title="Edit"
      subtitle={`Selected ${selection.el} #${selection.fid}`}
      defaultOpen
      right={
        <button className="btn btn-ghost text-xs" onClick={() => select(null)}>
          Deselect
        </button>
      }
    >
      {node && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Lat"
            value={node.lat}
            step={0.00001}
            onChange={(v) => moveNode(node.id, v, node.lon)}
          />
          <NumberField
            label="Lon"
            value={node.lon}
            step={0.00001}
            onChange={(v) => moveNode(node.id, node.lat, v)}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <span className="field-label">Tags</span>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              className="input flex-1 font-mono text-xs"
              value={r.k}
              placeholder="key"
              onChange={(e) => {
                const next = rows.slice();
                next[i] = { ...next[i], k: e.target.value };
                commit(next);
              }}
            />
            <input
              className="input flex-1 font-mono text-xs"
              value={r.v}
              placeholder="value"
              onChange={(e) => {
                const next = rows.slice();
                next[i] = { ...next[i], v: e.target.value };
                commit(next);
              }}
            />
            <button
              className="btn btn-ghost px-2 text-slate-500"
              onClick={() => commit(rows.filter((_, j) => j !== i))}
              title="Remove tag"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn w-full text-xs"
          onClick={() => commit([...rows, { k: "", v: "" }])}
        >
          + Add tag
        </button>
      </div>

      <button
        className="btn w-full border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20"
        onClick={deleteSelected}
      >
        Delete {selection.el}
      </button>
    </Section>
  );
}

type ProgressFn = (done: number, total: number) => void;

function heightmapMeta(box: Box, hm: HeightmapResult) {
  return {
    format: "osm-terrain-studio/heightmap@1",
    source: "Terrarium (AWS elevation-tiles-prod)",
    resolution: { width: hm.width, height: hm.height },
    elevationMeters: {
      min: Math.round(hm.minElev * 100) / 100,
      max: Math.round(hm.maxElev * 100) / 100,
      range: Math.round((hm.maxElev - hm.minElev) * 100) / 100,
    },
    encoding: {
      png: "16-bit grayscale, 0..65535 mapped linearly across [min,max]",
      raw: "16-bit unsigned little-endian, row 0 = north edge",
      reconstruct: "elevation_m = min + (value / 65535) * (max - min)",
    },
    area: {
      widthMeters: box.widthM,
      heightMeters: box.heightM,
      bearingDeg: box.bearingDeg,
      center: { lat: box.centerLat, lon: box.centerLon },
      bbox: boxBBox(box),
    },
  };
}

async function buildSatellitePng(
  box: Box,
  res: number,
  basemapId: BasemapId,
  onProgress: ProgressFn,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bm = BASEMAPS[basemapId];
  const grid = await sampleBoxRGBA({
    box,
    maxSize: res,
    tileTemplate: bm.tiles[0],
    maxZoom: bm.maxzoom,
    onProgress,
  });
  const blob = await rgbaToPngBlob(grid.rgba, grid.width, grid.height);
  return { blob, width: grid.width, height: grid.height };
}

async function buildHeightmapAssets(
  box: Box,
  res: number,
  square: boolean,
  onProgress: ProgressFn,
): Promise<{
  png: Blob;
  raw: Blob;
  meta: ReturnType<typeof heightmapMeta>;
  min: number;
  max: number;
  width: number;
  height: number;
}> {
  const hm = await sampleHeightmap(box, res, onProgress, square);
  const gray = elevToGray16(hm.elev, hm.minElev, hm.maxElev);
  return {
    png: gray16ToPng(gray, hm.width, hm.height),
    raw: gray16ToRaw(gray),
    meta: heightmapMeta(box, hm),
    min: hm.minElev,
    max: hm.maxElev,
    width: hm.width,
    height: hm.height,
  };
}

/**
 * Primary, foolproof export: one button produces a single ZIP containing the
 * road/river vector data, a heightmap and a clean satellite image, all clipped
 * to the box and pixel-aligned to the same rectangle, plus a README.
 */
function TerrainExportSection() {
  const box = useStore((s) => s.box);
  const setStatus = useStore((s) => s.setStatus);
  const [res, setRes] = useState(2048);
  const [busy, setBusy] = useState(false);

  const progress = (label: string): ProgressFn => (d, t) =>
    setStatus({ kind: "loading", message: `${label} ${d}/${t}…` });

  const ensureData = async (): Promise<OsmData | null> => {
    const existing = useStore.getState().data;
    if (existing) return existing;
    setStatus({ kind: "loading", message: "Fetching map data for the box…" });
    await useStore.getState().loadFromOverpass();
    return useStore.getState().data;
  };

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const exportBundle = () =>
    wrap(async () => {
      const data = await ensureData();
      const b = fileBase();
      const entries: ZipEntry[] = [];

      if (data) {
        entries.push(
          { name: `${b}-clipped.osm`, data: strBytes(buildClippedOsmXml(data, box)) },
          {
            name: `${b}-local.geojson`,
            data: strBytes(JSON.stringify(buildLocalGeoJSON(data, box))),
          },
          {
            name: `${b}-wgs84.geojson`,
            data: strBytes(JSON.stringify(buildClippedGeoJSON(data, box))),
          },
        );
      }

      const sat = await buildSatellitePng(box, res, "satellite", progress("Satellite tiles"));
      entries.push({
        name: `${b}-satellite-${sat.width}x${sat.height}.png`,
        data: await blobBytes(sat.blob),
      });

      const hm = await buildHeightmapAssets(box, res, false, progress("Elevation tiles"));
      entries.push(
        {
          name: `${b}-heightmap-${hm.width}x${hm.height}.png`,
          data: await blobBytes(hm.png),
        },
        {
          name: `${b}-heightmap-${hm.width}x${hm.height}.raw`,
          data: await blobBytes(hm.raw),
        },
        { name: `${b}-heightmap.json`, data: strBytes(JSON.stringify(hm.meta, null, 2)) },
      );

      const readme = buildTerrainReadme({
        box,
        basemap: "satellite",
        fileBase: b,
        image: { width: sat.width, height: sat.height },
        elevation: { min: hm.min, max: hm.max },
        hasVector: Boolean(data),
      });
      entries.push({ name: `${b}-README.txt`, data: strBytes(readme) });

      setStatus({ kind: "loading", message: "Packaging ZIP…" });
      downloadBlob(`${b}-terrain-bundle.zip`, createZip(entries));
      setStatus({
        kind: "info",
        message: data
          ? "Terrain bundle exported (.zip)"
          : "Bundle exported, but no vector data was available — fetch the box area for roads/rivers.",
      });
    });

  const exportVectorOsm = () =>
    wrap(async () => {
      const data = await ensureData();
      if (!data) return;
      downloadText(`${fileBase()}-clipped.osm`, buildClippedOsmXml(data, box), "application/xml");
      setStatus({ kind: "info", message: "Roads & data exported (.osm, clipped to box)" });
    });

  const exportVectorGeoJSON = () =>
    wrap(async () => {
      const data = await ensureData();
      if (!data) return;
      downloadText(
        `${fileBase()}-local.geojson`,
        JSON.stringify(buildLocalGeoJSON(data, box), null, 2),
        "application/geo+json",
      );
      setStatus({ kind: "info", message: "Vector exported (GeoJSON, local metres)" });
    });

  const exportHeightmapPng = () =>
    wrap(async () => {
      const hm = await buildHeightmapAssets(box, res, false, progress("Elevation tiles"));
      downloadBlob(`${fileBase()}-heightmap-${hm.width}x${hm.height}.png`, hm.png);
      setStatus({
        kind: "info",
        message: `Heightmap exported (${hm.min.toFixed(0)}–${hm.max.toFixed(0)} m, range ${(hm.max - hm.min).toFixed(0)} m)`,
      });
    });

  const exportSatellitePng = () =>
    wrap(async () => {
      const sat = await buildSatellitePng(box, res, "satellite", progress("Satellite tiles"));
      downloadBlob(`${fileBase()}-satellite-${sat.width}x${sat.height}.png`, sat.blob);
      setStatus({ kind: "info", message: "Satellite image exported" });
    });

  return (
    <Section
      title="Terrain export"
      subtitle="Everything you need for Blender/Unity — clipped to the box and aligned."
      defaultOpen
    >
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Box: <span className="text-slate-200">{(box.widthM / 1000).toFixed(2)} ×{" "}
          {(box.heightM / 1000).toFixed(2)} km</span>. The bundle clips the OSM
          data to this box and renders the heightmap and satellite image to the
          same rectangle so they line up perfectly.
        </p>

        <label className="block">
          <span className="field-label">Image resolution (long edge)</span>
          <select
            className="input mt-1"
            value={res}
            onChange={(e) => setRes(Number(e.target.value))}
          >
            <option value={1024}>1024 px</option>
            <option value={2048}>2048 px (recommended)</option>
            <option value={4096}>4096 px</option>
          </select>
        </label>

        <button
          className="btn btn-primary w-full"
          onClick={exportBundle}
          disabled={busy}
        >
          {busy ? "Working…" : "⬇ Export terrain bundle (.zip)"}
        </button>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Includes: roads/rivers (.osm + GeoJSON), heightmap (PNG + RAW + JSON),
          satellite image (PNG) and a README. Map data is fetched automatically
          if you haven't loaded it yet.
        </p>

        <div className="field-label border-t border-edge/60 pt-3">
          Or grab one at a time
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={exportVectorOsm} disabled={busy}>
            Roads &amp; data (.osm)
          </button>
          <button className="btn" onClick={exportVectorGeoJSON} disabled={busy}>
            Vector (GeoJSON, m)
          </button>
          <button className="btn" onClick={exportHeightmapPng} disabled={busy}>
            Heightmap (PNG)
          </button>
          <button className="btn" onClick={exportSatellitePng} disabled={busy}>
            Satellite (PNG)
          </button>
        </div>
      </div>
    </Section>
  );
}

/** Power-user exports: full dataset, region clips, CSV, square heightmaps, etc. */
function AdvancedExportSection() {
  const data = useStore((s) => s.data);
  const box = useStore((s) => s.box);
  const freehand = useStore((s) => s.freehand);
  const basemap = useStore((s) => s.basemap);
  const setStatus = useStore((s) => s.setStatus);
  const [filter, setFilter] = useState<RoadFilter>("roads");
  const [imgSize, setImgSize] = useState(2048);
  const [hmSize, setHmSize] = useState(1025);
  const [busy, setBusy] = useState(false);

  const dl = (fn: () => void) => {
    if (data) fn();
  };

  const exportRegionImage = async (basemapId = basemap, maskFreehand = false) => {
    setBusy(true);
    setStatus({ kind: "loading", message: "Rendering image…" });
    try {
      const bm = BASEMAPS[basemapId];
      const grid = await sampleBoxRGBA({
        box,
        maxSize: imgSize,
        tileTemplate: bm.tiles[0],
        maxZoom: bm.maxzoom,
        onProgress: (d, t) =>
          setStatus({ kind: "loading", message: `Loading tiles ${d}/${t}…` }),
      });
      const rgba =
        maskFreehand && freehand
          ? maskGridToRing(grid.rgba, grid.width, grid.height, box, freehand)
          : grid.rgba;
      const blob = await rgbaToPngBlob(rgba, grid.width, grid.height);
      const scope = maskFreehand ? "freehand" : "box";
      downloadBlob(`${fileBase()}-${scope}-${basemapId}-${grid.width}x${grid.height}.png`, blob);
      setStatus({ kind: "info", message: "Image exported" });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? `Image export failed: ${err.message}` : "Image export failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const exportSquareHeightmap = async () => {
    setBusy(true);
    setStatus({ kind: "loading", message: "Sampling elevation…" });
    try {
      const hm = await buildHeightmapAssets(box, hmSize, true, (d, t) =>
        setStatus({ kind: "loading", message: `Loading elevation tiles ${d}/${t}…` }),
      );
      const base = fileBase();
      downloadBlob(`${base}-heightmap-${hm.width}.png`, hm.png);
      downloadBlob(`${base}-heightmap-${hm.width}.raw`, hm.raw);
      downloadText(
        `${base}-heightmap-${hm.width}.json`,
        JSON.stringify(hm.meta, null, 2),
        "application/json",
      );
      setStatus({
        kind: "info",
        message: `Square heightmap exported (${hm.min.toFixed(0)}–${hm.max.toFixed(0)} m)`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? `Heightmap failed: ${err.message}` : "Heightmap failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Advanced exports"
      subtitle="Full dataset, region clips, CSV, square (Unity) heightmaps."
      defaultOpen={false}
    >
      <div className="space-y-2">
        <div className="field-label">Vector — full / original (loaded data)</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn"
            disabled={!data}
            onClick={() =>
              dl(() => downloadText(`${fileBase()}.osm`, buildFullOsmXml(data!), "application/xml"))
            }
          >
            .osm file
          </button>
          <button
            className="btn"
            disabled={!data}
            onClick={() =>
              dl(() =>
                downloadText(
                  `${fileBase()}.geojson`,
                  JSON.stringify(buildFullGeoJSON(data!), null, 2),
                  "application/geo+json",
                ),
              )
            }
          >
            GeoJSON
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-edge/60 pt-3">
        <div className="field-label">Vector — clipped to box</div>
        <button
          className="btn w-full"
          disabled={!data}
          onClick={() =>
            dl(() =>
              downloadText(
                `${fileBase()}-box.geojson`,
                JSON.stringify(buildClippedGeoJSON(data!, box), null, 2),
                "application/geo+json",
              ),
            )
          }
        >
          GeoJSON (WGS84, clipped)
        </button>
        <label className="block">
          <span className="field-label">Line filter (CSV)</span>
          <select
            className="input mt-1"
            value={filter}
            onChange={(e) => setFilter(e.target.value as RoadFilter)}
          >
            <option value="roads">Roads only (drivable)</option>
            <option value="roads+paths">Roads + paths</option>
            <option value="all-lines">All lines (rivers, rails…)</option>
          </select>
        </label>
        <button
          className="btn w-full"
          disabled={!data}
          onClick={() =>
            dl(() => downloadText(`${fileBase()}-roads.csv`, buildRoadCsv(data!, box, filter), "text/csv"))
          }
        >
          Road vertices (.csv, local m + lat/lon)
        </button>
      </div>

      {freehand && (
        <div className="space-y-2 border-t border-edge/60 pt-3">
          <div className="field-label text-amber-300/80">Vector — clipped to region</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn"
              disabled={!data}
              onClick={() =>
                dl(() =>
                  downloadText(
                    `${fileBase()}-region.osm`,
                    buildRegionOsmXml(data!, freehand),
                    "application/xml",
                  ),
                )
              }
            >
              .osm (region)
            </button>
            <button
              className="btn"
              disabled={!data}
              onClick={() =>
                dl(() =>
                  downloadText(
                    `${fileBase()}-region.geojson`,
                    JSON.stringify(buildRegionGeoJSON(data!, freehand), null, 2),
                    "application/geo+json",
                  ),
                )
              }
            >
              GeoJSON (region)
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-edge/60 pt-3">
        <div className="field-label">Imagery — basemap &amp; freehand</div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={imgSize}
            onChange={(e) => setImgSize(Number(e.target.value))}
          >
            <option value={1024}>1024 px</option>
            <option value={2048}>2048 px</option>
            <option value={4096}>4096 px</option>
          </select>
          <button
            className="btn shrink-0"
            onClick={() => exportRegionImage(basemap, false)}
            disabled={busy}
          >
            {busy ? "Working…" : `Box image (${basemap})`}
          </button>
        </div>
        {freehand && (
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn"
              onClick={() => exportRegionImage("satellite", true)}
              disabled={busy}
            >
              Satellite freehand
            </button>
            <button
              className="btn"
              onClick={() => exportRegionImage(basemap, true)}
              disabled={busy}
            >
              Basemap freehand
            </button>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-slate-500">
          Freehand image exports keep the drawn region and make everything
          outside it transparent.
        </p>
      </div>

      <div className="space-y-2 border-t border-edge/60 pt-3">
        <div className="field-label">Heightmap — square (Unity 2^n+1)</div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={hmSize}
            onChange={(e) => setHmSize(Number(e.target.value))}
          >
            <option value={513}>513 px</option>
            <option value={1025}>1025 px</option>
            <option value={2049}>2049 px</option>
          </select>
          <button className="btn shrink-0" onClick={exportSquareHeightmap} disabled={busy}>
            {busy ? "Working…" : "Square heightmap"}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Forces a square grid for Unity terrains. For Blender, prefer the
          aspect-correct heightmap in the Terrain export above.
        </p>
      </div>
    </Section>
  );
}

function SceneSection() {
  const box = useStore((s) => s.box);
  const view = useStore((s) => s.view);
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);
  const commandView = useStore((s) => s.commandView);

  const state: SceneState = { box, view, basemap };
  const bb = boxBBox(box);
  const norm = ((view.bearing % 360) + 360) % 360;

  const copyPermalink = () => {
    const hash = encodeScene(state);
    const url = `${location.origin}${location.pathname}#${hash}`;
    history.replaceState(null, "", `#${hash}`);
    copyToClipboard(url);
  };

  return (
    <Section
      title="Scene & share"
      subtitle="The exact state of the view — copy it, screenshot it, or share a link to reproduce it anywhere."
      defaultOpen={false}
    >
      <div>
        <span className="field-label">Basemap</span>
        <div className="mt-1 grid grid-cols-4 gap-1.5">
          {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
            <button
              key={id}
              className={`btn text-xs ${basemap === id ? "btn-primary" : ""}`}
              onClick={() => setBasemap(id)}
            >
              {BASEMAPS[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Map rotation"
          value={Math.round(norm * 10) / 10}
          step={1}
          suffix="°"
          onChange={(v) => commandView({ bearing: ((v % 360) + 360) % 360 })}
        />
        <NumberField
          label="Map zoom"
          value={Math.round(view.zoom * 100) / 100}
          step={0.5}
          min={1}
          max={20}
          onChange={(v) => commandView({ zoom: v })}
        />
      </div>

      <div className="rounded-md border border-edge/70 bg-panel px-3 py-2.5 text-[11px] leading-relaxed">
        <Row label="Map center" value={`${view.lat.toFixed(6)}, ${view.lng.toFixed(6)}`} />
        <Row label="Map zoom / rot" value={`${view.zoom.toFixed(2)} · ${norm.toFixed(1)}°`} />
        <Row
          label="Box center"
          value={`${box.centerLat.toFixed(6)}, ${box.centerLon.toFixed(6)}`}
        />
        <Row
          label="Box size"
          value={`${(box.widthM / 1000).toFixed(3)} × ${(box.heightM / 1000).toFixed(3)} km`}
        />
        <Row label="Box rotation" value={`${box.bearingDeg.toFixed(1)}°`} />
        <Row
          label="BBox"
          value={`${bb.minLon.toFixed(5)},${bb.minLat.toFixed(5)},${bb.maxLon.toFixed(5)},${bb.maxLat.toFixed(5)}`}
          mono
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-primary" onClick={copyPermalink}>
          Copy share link
        </button>
        <button className="btn" onClick={() => copyToClipboard(buildSceneSummary(state))}>
          Copy details
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn text-xs"
          onClick={() =>
            copyToClipboard(
              `${bb.minLon.toFixed(6)},${bb.minLat.toFixed(6)},${bb.maxLon.toFixed(6)},${bb.maxLat.toFixed(6)}`,
            )
          }
        >
          Copy bbox
        </button>
        <a className="btn text-xs" href={osmLink(view)} target="_blank" rel="noopener noreferrer">
          Open in OSM
        </a>
      </div>
      <a
        className="block text-center text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        href={googleMapsLink(view)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in Google Maps
      </a>
    </Section>
  );
}

function Row({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span
        className={`truncate text-right text-slate-300 ${mono ? "font-mono text-[10px]" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-r border-edge bg-panel-2">
      <header className="flex items-center gap-3 border-b border-edge px-4 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/40 bg-accent/10">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none">
            <g transform="rotate(18 12 12)">
              <rect x="5" y="3.5" width="14" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M7 16 L11 10 L14 13 L17 6" stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold leading-tight text-slate-50">
            OSM Terrain Studio
          </h1>
          <p className="text-[11px] leading-tight text-slate-500">
            Rotate · box · measure · export OSM data
          </p>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <DataSection />
        <BoxSection />
        <TerrainExportSection />
        <MeasureSection />
        <EditSection />
        <AdvancedExportSection />
        <SceneSection />
        <div className="px-4 py-4 text-[10px] leading-relaxed text-slate-600">
          Coordinates use a local tangent-plane projection accurate to sub-metre
          over typical areas. Data © OpenStreetMap contributors (ODbL).
        </div>
      </div>
    </aside>
  );
}
