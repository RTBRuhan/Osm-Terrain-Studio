import { useStore } from "../store";

export default function Toolbar({
  mapBearing,
  onResetNorth,
}: {
  mapBearing: number;
  onResetNorth: () => void;
}) {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const boxVisible = useStore((s) => s.boxVisible);
  const setBoxVisible = useStore((s) => s.setBoxVisible);

  const norm = ((mapBearing % 360) + 360) % 360;

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-edge bg-panel-2/95 p-1 shadow-xl backdrop-blur">
        <button
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tool === "pan" ? "bg-accent/20 text-accent" : "text-slate-300 hover:bg-panel-3"
          }`}
          onClick={() => setTool("pan")}
        >
          Pan / Edit
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tool === "draw" ? "bg-accent/20 text-accent" : "text-slate-300 hover:bg-panel-3"
          }`}
          onClick={() => setTool("draw")}
        >
          Draw box
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tool === "freedraw"
              ? "bg-amber-500/20 text-amber-300"
              : "text-slate-300 hover:bg-panel-3"
          }`}
          onClick={() => setTool("freedraw")}
        >
          Free draw
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tool === "measure"
              ? "bg-emerald-500/20 text-emerald-300"
              : "text-slate-300 hover:bg-panel-3"
          }`}
          onClick={() => setTool("measure")}
        >
          Measure
        </button>
        <div className="mx-1 h-5 w-px bg-edge" />
        <button
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            boxVisible ? "text-slate-300 hover:bg-panel-3" : "text-slate-500 hover:bg-panel-3"
          }`}
          onClick={() => setBoxVisible(!boxVisible)}
        >
          {boxVisible ? "Hide box" : "Show box"}
        </button>
      </div>

      <button
        className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-edge bg-panel-2/95 px-3 py-2 text-xs font-medium text-slate-300 shadow-xl backdrop-blur transition hover:border-accent/50"
        onClick={onResetNorth}
        title="Reset map rotation to north"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-accent"
          style={{ transform: `rotate(${-norm}deg)` }}
          fill="none"
        >
          <path d="M12 2 L15 12 L12 9 L9 12 Z" fill="currentColor" />
          <path d="M12 9 L12 22" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span className="font-mono">{norm.toFixed(0)}°</span>
      </button>
    </div>
  );
}
