import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { BoxFrame, formatArea, formatMeters } from "../lib/geo";
import { BASEMAPS, type BasemapId } from "../lib/basemaps";
import {
  buildClippedGeoJSON,
  buildClippedOsmXml,
  buildLocalGeoJSON,
  buildRoadCsv,
  buildUnityExport,
  downloadText,
  type RoadFilter,
} from "../lib/exports";
import type { Tags } from "../lib/osm";
import { NumberField, Section, Stat } from "./ui";

const BOX_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1 × 1", w: 1000, h: 1000 },
  { label: "2 × 2", w: 2000, h: 2000 },
  { label: "5 × 5", w: 5000, h: 5000 },
  { label: "5 × 10", w: 5000, h: 10000 },
  { label: "10 × 10", w: 10000, h: 10000 },
];

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
      title="Data"
      subtitle="Upload an .osm export, or pull the box area from OpenStreetMap."
    >
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

  const scale = (factor: number) =>
    updateBox({
      widthM: Math.max(10, Math.round(box.widthM * factor)),
      heightM: Math.max(10, Math.round(box.heightM * factor)),
    });

  const area = box.widthM * box.heightM;
  const diagonal = Math.hypot(box.widthM, box.heightM);

  return (
    <Section
      title="Selection box"
      subtitle="The georeferenced rectangle that maps onto your terrain."
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
        <NumberField
          label="Width (X)"
          value={Math.round(box.widthM) / 1000}
          step={0.1}
          min={0.01}
          suffix="km"
          onChange={(v) => updateBox({ widthM: Math.max(10, v * 1000) })}
        />
        <NumberField
          label="Height (Z)"
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
        <div className="flex items-center justify-between">
          <span className="field-label">Rotation</span>
          <span className="font-mono text-xs text-slate-400">
            {box.bearingDeg.toFixed(1)}°
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={360}
          step={0.5}
          value={box.bearingDeg}
          onChange={(e) => updateBox({ bearingDeg: parseFloat(e.target.value) })}
          className="mt-2 w-full accent-accent"
        />
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          <button className="btn text-xs" onClick={() => updateBox({ bearingDeg: (box.bearingDeg + 315) % 360 })}>
            −45°
          </button>
          <button className="btn text-xs" onClick={() => updateBox({ bearingDeg: (box.bearingDeg + 359) % 360 })}>
            −1°
          </button>
          <button className="btn text-xs" onClick={() => updateBox({ bearingDeg: (box.bearingDeg + 1) % 360 })}>
            +1°
          </button>
          <button className="btn text-xs" onClick={() => updateBox({ bearingDeg: (box.bearingDeg + 45) % 360 })}>
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
    if (target) {
      setRows(Object.entries(target.tags).map(([k, v]) => ({ k, v })));
    } else {
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.fid, selection?.el]);

  if (!selection || !target) {
    return (
      <Section
        title="Edit"
        subtitle="Click a road, building, or point on the map to select and edit it."
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

function ExportSection() {
  const data = useStore((s) => s.data);
  const box = useStore((s) => s.box);
  const [filter, setFilter] = useState<RoadFilter>("roads");

  const base = (useStore.getState().fileName ?? "osm-terrain")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-");

  const guard = (fn: () => void) => {
    if (!data) return;
    fn();
  };

  const previewFrame = new BoxFrame(box);
  const origin = previewFrame.toLatLonFromLocal(0, 0);

  return (
    <Section
      title="Export"
      subtitle="Everything is clipped to the box. Local/Unity formats use terrain metres."
    >
      <label className="block">
        <span className="field-label">Line filter (for Unity / CSV)</span>
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

      <div className="grid grid-cols-1 gap-2">
        <button
          className="btn btn-primary"
          disabled={!data}
          onClick={() =>
            guard(() =>
              downloadText(
                `${base}-clip.osm`,
                buildClippedOsmXml(data!, box),
                "application/xml",
              ),
            )
          }
        >
          OSM XML (clipped)
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn"
            disabled={!data}
            onClick={() =>
              guard(() =>
                downloadText(
                  `${base}-clip.geojson`,
                  JSON.stringify(buildClippedGeoJSON(data!, box), null, 2),
                  "application/geo+json",
                ),
              )
            }
          >
            GeoJSON (WGS84)
          </button>
          <button
            className="btn"
            disabled={!data}
            onClick={() =>
              guard(() =>
                downloadText(
                  `${base}-local.geojson`,
                  JSON.stringify(buildLocalGeoJSON(data!, box), null, 2),
                  "application/geo+json",
                ),
              )
            }
          >
            GeoJSON (local m)
          </button>
        </div>
        <button
          className="btn"
          disabled={!data}
          onClick={() =>
            guard(() =>
              downloadText(
                `${base}-unity-roads.json`,
                JSON.stringify(buildUnityExport(data!, box, filter), null, 2),
                "application/json",
              ),
            )
          }
        >
          Unity / EasyRoad3D roads (.json)
        </button>
        <button
          className="btn"
          disabled={!data}
          onClick={() =>
            guard(() =>
              downloadText(
                `${base}-roads.csv`,
                buildRoadCsv(data!, box, filter),
                "text/csv",
              ),
            )
          }
        >
          Road vertices (.csv)
        </button>
      </div>

      <div className="rounded-md border border-edge/70 bg-panel px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        <div>
          Terrain origin (x0,z0):{" "}
          <span className="font-mono text-slate-300">
            {origin.lat.toFixed(6)}, {origin.lon.toFixed(6)}
          </span>
        </div>
        <div>
          Size:{" "}
          <span className="font-mono text-slate-300">
            {(box.widthM / 1000).toFixed(3)} × {(box.heightM / 1000).toFixed(3)} km
          </span>{" "}
          · bearing{" "}
          <span className="font-mono text-slate-300">
            {box.bearingDeg.toFixed(1)}°
          </span>
        </div>
      </div>
    </Section>
  );
}

function ViewSection() {
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);
  return (
    <Section title="Basemap" subtitle="Underlay imagery. Rotate the map with right-drag.">
      <div className="grid grid-cols-4 gap-1.5">
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
    </Section>
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
            Rotate · box · scale · export for game terrains
          </p>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <DataSection />
        <BoxSection />
        <EditSection />
        <ExportSection />
        <ViewSection />
        <div className="px-4 py-4 text-[10px] leading-relaxed text-slate-600">
          Coordinates use a local tangent-plane projection accurate to sub-metre
          over typical terrain sizes. Data © OpenStreetMap contributors (ODbL).
        </div>
      </div>
    </aside>
  );
}
