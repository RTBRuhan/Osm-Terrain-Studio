import { useState, type ReactNode } from "react";

export function Section({
  title,
  subtitle,
  children,
  right,
  defaultOpen = true,
  collapsible = true,
  badge,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  return (
    <section className="section">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => collapsible && setOpen((v) => !v)}
          disabled={!collapsible}
        >
          {collapsible && (
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
              fill="none"
            >
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{title}</span>
            {badge}
          </span>
        </button>
        {right}
      </div>
      {isOpen && (
        <div className="px-4 pb-4">
          {subtitle && (
            <p className="-mt-1 mb-3 text-[11px] leading-snug text-slate-500">
              {subtitle}
            </p>
          )}
          <div className="space-y-3">{children}</div>
        </div>
      )}
    </section>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="relative mt-1">
        <input
          type="number"
          className="input pr-9 font-mono"
          value={Number.isFinite(value) ? value : ""}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(v);
            else if (e.target.value === "") onChange(0);
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-edge/70 bg-panel px-2.5 py-2">
      <div className="font-mono text-sm text-slate-100">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}
