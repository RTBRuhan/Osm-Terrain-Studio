const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["V", "Esc"], action: "Pan / select (Esc also cancels & deselects)" },
  { keys: ["D"], action: "Draw box tool" },
  { keys: ["F"], action: "Free draw region tool" },
  { keys: ["M"], action: "Measure tool" },
  { keys: ["B"], action: "Show / hide the box" },
  { keys: ["Z"], action: "Zoom to box" },
  { keys: ["R"], action: "Reset map rotation to north" },
  { keys: ["[", "]"], action: "Rotate box −1° / +1°" },
  { keys: ["Del", "⌫"], action: "Delete selected feature" },
  { keys: ["1", "2", "3", "4"], action: "Basemap: Dark / Light / Streets / Satellite" },
  { keys: ["?"], action: "Open this help" },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[22px] items-center justify-center rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[11px] text-slate-200 shadow-sm">
      {children}
    </kbd>
  );
}

export default function HelpButton({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <>
      <button
        className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel-2/95 text-slate-300 shadow-xl backdrop-blur transition hover:border-accent/60 hover:text-accent"
        onClick={() => setOpen(true)}
        title="Help & shortcuts (?)"
        aria-label="Help and shortcuts"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8v.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17" r="1" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="scroll-thin max-h-[86vh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-panel-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-5 py-4">
              <h2 className="text-base font-semibold text-slate-50">
                Help &amp; shortcuts
              </h2>
              <button
                className="btn btn-ghost px-2 text-slate-400"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 px-5 py-4">
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Quick start
                </h3>
                <ul className="space-y-1.5 text-sm text-slate-300">
                  <li>
                    <span className="text-slate-400">Rotate the map:</span>{" "}
                    right-click&nbsp;+&nbsp;drag (or the compass control).
                  </li>
                  <li>
                    <span className="text-slate-400">Box:</span> set exact km
                    size, drag to move, drag the cyan handle to rotate. The
                    orange dot marks the box's local (0,0) origin.
                  </li>
                  <li>
                    <span className="text-slate-400">Free draw:</span> trace any
                    region, then export OSM/GeoJSON clipped to that shape.
                  </li>
                  <li>
                    <span className="text-slate-400">Data:</span> upload an
                    .osm file (drag &amp; drop works) or fetch the box area.
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Keyboard shortcuts
                </h3>
                <div className="overflow-hidden rounded-lg border border-edge/70">
                  {SHORTCUTS.map((s, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                        i % 2 ? "bg-panel/40" : ""
                      }`}
                    >
                      <span className="text-slate-300">{s.action}</span>
                      <span className="flex shrink-0 gap-1">
                        {s.keys.map((k) => (
                          <Key key={k}>{k}</Key>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-edge/70 pt-4">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  About
                </h3>
                <p className="text-sm text-slate-300">
                  OSM Terrain Studio — a free, open, general-purpose tool to
                  view, edit and export OpenStreetMap data, imagery and
                  heightmaps for any area you draw.
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Made by{" "}
                  <a
                    href="https://rtbruhan.github.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                  >
                    RTB Ruhan
                  </a>
                  .
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Map data © OpenStreetMap contributors (ODbL). Basemap tiles ©
                  their respective providers.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
