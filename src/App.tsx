import { useRef, useState } from "react";
import MapView, { type MapHandle } from "./components/MapView";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import StatusToast from "./components/StatusToast";
import { useStore } from "./store";

const LEGEND: { label: string; color: string }[] = [
  { label: "Roads", color: "#f1f5f9" },
  { label: "Paths", color: "#a8a29e" },
  { label: "Water", color: "#38bdf8" },
  { label: "Green", color: "#4ade80" },
  { label: "Buildings", color: "#94a3b8" },
  { label: "Selected", color: "#fbbf24" },
];

function Legend() {
  return (
    <div className="absolute bottom-6 right-3 z-10 rounded-lg border border-edge bg-panel-2/90 px-3 py-2.5 text-[11px] shadow-xl backdrop-blur">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {LEGEND.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: l.color }}
            />
            <span className="text-slate-300">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const mapRef = useRef<MapHandle>(null);
  const [mapBearing, setMapBearing] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const loadOsmText = useStore((s) => s.loadOsmText);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => loadOsmText(String(reader.result), file.name);
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <div
        className="relative flex-1"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <MapView ref={mapRef} onBearingChange={setMapBearing} />
        <Toolbar
          mapBearing={mapBearing}
          onResetNorth={() => mapRef.current?.resetNorth()}
        />
        <Legend />
        <StatusToast />
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-4 border-dashed border-accent/60 bg-panel/60 backdrop-blur-sm">
            <div className="rounded-xl border border-accent/40 bg-panel-2 px-6 py-4 text-sm font-medium text-accent shadow-2xl">
              Drop your .osm file to load
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
