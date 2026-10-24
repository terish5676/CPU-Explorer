import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  index,
  title,
  italic,
  description,
  children,
}: {
  index: string;
  title: string;
  italic?: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="rise relative border-b border-rule pb-8 pt-10">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="label-mono">Fig. {index}</p>
          <h1 className="mt-3 text-[clamp(3rem,8vw,6.5rem)] leading-[0.92]">
            {title} {italic && <em className="text-signal">{italic}</em>}
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-2">{description}</p>
          {children && <div className="mt-5 flex flex-wrap items-center gap-3">{children}</div>}
        </div>
        <span
          aria-hidden
          className="numeral hidden select-none text-[11rem] text-transparent [-webkit-text-stroke:1px_var(--ink)] opacity-25 lg:block"
        >
          {index}
        </span>
      </div>
    </section>
  );
}

export function DataBadge({ source }: { source: "Simulated" | "User trace" | "Measured" | string }) {
  const isMeasured = source === "Measured";
  const label =
    source === "Measured"
      ? "Live Execution · Measured"
      : source === "User trace"
        ? "Address Trace · Verified"
        : source === "Simulated"
          ? "Microarchitecture · Cycle-Accurate"
          : source;

  return (
    <span
      className={cn(
        "inline-flex -rotate-1 items-center gap-1.5 border border-dashed px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        isMeasured ? "border-hit text-hit bg-hit/5" : "border-signal text-signal bg-signal/5",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="label-mono">{label}</p>
      <p className={cn("numeral mt-3 text-6xl", accent && "text-signal")}>{value}</p>
      {sub && <p className="mt-2 font-mono text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

/** Titled drawing-sheet block. */
export function Sheet({
  title,
  tag,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  tag?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel panel-tick", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2">
        <h2 className="flex items-baseline gap-3">
          <span className="font-display text-2xl leading-none">{title}</span>
          {tag && <span className="label-mono">{tag}</span>}
        </h2>
        {actions}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="label-mono">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-[11px] text-ink-3">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-5 w-10 shrink-0 border border-ink transition-colors",
          checked ? "bg-signal" : "bg-transparent",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 bg-ink transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="hatch relative flex min-h-56 items-center justify-center border border-dashed border-rule p-8 text-center">
      <p className="max-w-sm bg-paper px-3 py-1 text-sm text-ink-2">{children}</p>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="inline-flex border border-ink" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
            value === o.id ? "bg-ink text-paper" : "hover:bg-paper-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
