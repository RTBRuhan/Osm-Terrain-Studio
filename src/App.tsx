import { useEffect, useRef, useState } from "react";
import MapView, { type MapHandle } from "./components/MapView";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import StatusToast from "./components/StatusToast";
import HelpButton from "./components/HelpButton";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const loadOsmText = useStore((s) => s.loadOsmText);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useStore.getState();
      switch (e.key) {
        case "Escape":
          if (s.tool === "measure") {
            s.clearMeasure();
            s.setTool("pan");
          } else if (s.tool !== "pan") {
            s.setTool("pan");
          } else if (s.selection) {
            s.select(null);
          } else {
            setHelpOpen(false);
          }
          break;
        case "v":
        case "V":
          s.setTool("pan");
          break;
        case "d":
        case "D":
          s.setTool("draw");
          break;
        case "f":
        case "F":
          s.setTool("freedraw");
          break;
        case "m":
        case "M":
          s.setTool("measure");
          break;
        case "b":
        case "B":
          s.setBoxVisible(!s.boxVisible);
          break;
        case "z":
        case "Z":
          s.focusOnBox();
          break;
        case "r":
        case "R":
          mapRef.current?.resetNorth();
          break;
        case "[":
          s.updateBox({ bearingDeg: (s.box.bearingDeg + 359) % 360 });
          break;
        case "]":
          s.updateBox({ bearingDeg: (s.box.bearingDeg + 1) % 360 });
          break;
        case "Delete":
        case "Backspace":
          if (s.selection) {
            e.preventDefault();
            s.deleteSelected();
          }
          break;
        case "1":
          s.setBasemap("dark");
          break;
        case "2":
          s.setBasemap("light");
          break;
        case "3":
          s.setBasemap("streets");
          break;
        case "4":
          s.setBasemap("satellite");
          break;
        case "?":
          setHelpOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        <HelpButton open={helpOpen} setOpen={setHelpOpen} />
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
