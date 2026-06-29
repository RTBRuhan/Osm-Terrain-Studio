import { useEffect } from "react";
import { useStore } from "../store";

export default function StatusToast() {
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);

  useEffect(() => {
    if (status.kind === "info") {
      const t = setTimeout(() => setStatus({ kind: "idle" }), 4000);
      return () => clearTimeout(t);
    }
  }, [status, setStatus]);

  if (status.kind === "idle" || !status.message) return null;

  const tone =
    status.kind === "error"
      ? "border-red-500/40 bg-red-500/15 text-red-200"
      : status.kind === "loading"
        ? "border-accent/40 bg-accent/15 text-accent"
        : "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-2xl backdrop-blur ${tone}`}
      >
        {status.kind === "loading" && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        <span>{status.message}</span>
        {status.kind === "error" && (
          <button
            className="ml-1 text-current/70 hover:text-current"
            onClick={() => setStatus({ kind: "idle" })}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
