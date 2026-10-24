import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { METRIC_LABELS, fmtMetric, useRuns, type RunKind } from "@/lib/runs-store";
import { seedDemoRuns } from "@/lib/seed";
import { provenanceOf } from "@/lib/provenance";
import { DataBadge, Empty, Kpi, PageHeader, Segmented, Sheet } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/monitor")({
  head: () => ({
    meta: [
      { title: "Performance Monitor — CPU Performance Explorer" },
      { name: "description", content: "Chart any metric across every saved run." },
    ],
  }),
  component: Monitor,
});

function Monitor() {
  const runs = useRuns();
  const [kind, setKind] = useState<RunKind | "all">("all");
  const [metric, setMetric] = useState<string>("");
  const filtered = useMemo(
    () => runs.filter((r) => kind === "all" || r.kind === kind),
    [runs, kind],
  );
  const metrics = useMemo(
    () => [...new Set(filtered.flatMap((r) => Object.keys(r.metrics)))],
    [filtered],
  );
  const active = metrics.includes(metric) ? metric : (metrics[0] ?? "");
  const rows = useMemo(
    () => filtered.filter((r) => typeof r.metrics[active] === "number").reverse(),
    [filtered, active],
  );
  const vals = rows.map((r) => r.metrics[active]!);
  const max = Math.max(1e-9, ...vals),
    min = Math.min(...vals);
  const byKind = (k: RunKind) => runs.filter((r) => r.kind === k).length;

  return (
    <div>
      <PageHeader
        index="06"
        title="Performance"
        italic="monitor"
        description="Every run you save lands here. Pick a metric and compare it across configurations — lowest and highest are flagged."
      >
        <DataBadge source={provenanceOf(runs.map((r) => r.source))} />
      </PageHeader>

      {runs.length === 0 ? (
        <div className="mt-8">
          <Empty>
            No saved runs yet. Save one from a simulator, or{" "}
            <button
              className="underline decoration-signal decoration-2 underline-offset-4"
              onClick={() => {
                seedDemoRuns();
                toast.success("Seeded with real simulator output");
              }}
            >
              load sample runs
            </button>
            .
          </Empty>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi accent label="Saved runs" value={String(runs.length)} />
            <Kpi label="Cache" value={String(byKind("cache"))} />
            <Kpi label="Pipeline" value={String(byKind("pipeline"))} />
            <Kpi label="Code · Memory" value={`${byKind("code")}·${byKind("memory")}`} />
          </div>
          <Sheet
            title="Compare"
            tag="A"
            actions={
              <Segmented<RunKind | "all">
                value={kind}
                onChange={setKind}
                options={[
                  { id: "all", label: "All" },
                  { id: "cache", label: "Cache" },
                  { id: "pipeline", label: "Pipe" },
                  { id: "code", label: "Code" },
                  { id: "memory", label: "Mem" },
                ]}
              />
            }
          >
            {metrics.length === 0 ? (
              <p className="text-sm text-ink-3">No runs of this kind.</p>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {metrics.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMetric(m)}
                      className={cn("btn btn-sm", m !== active && "btn-ghost")}
                    >
                      {METRIC_LABELS[m]?.label ?? m}
                    </button>
                  ))}
                </div>
                <ul className="space-y-2">
                  {rows.map((r) => {
                    const v = r.metrics[active]!;
                    const flag =
                      rows.length > 1 && v === max
                        ? "max"
                        : rows.length > 1 && v === min
                          ? "min"
                          : null;
                    return (
                      <li
                        key={r.id}
                        className="grid items-center gap-3 font-mono text-xs md:grid-cols-[minmax(0,22rem)_1fr_7rem]"
                      >
                        <span className="truncate" title={r.name}>
                          {r.name}
                        </span>
                        <span className="h-6 border border-rule">
                          <span
                            className={cn(
                              "block h-full transition-all duration-500",
                              flag === "max" ? "bg-signal" : flag === "min" ? "bg-hit" : "bg-ink",
                            )}
                            style={{ width: `${Math.max(1.5, (v / max) * 100)}%` }}
                          />
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <b>{fmtMetric(active, v)}</b>
                          {flag && (
                            <em className="not-italic text-[10px] uppercase text-ink-3">{flag}</em>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Sheet>
          <p className="text-sm text-ink-2">
            Ready to find out <i>why</i> two runs differ?{" "}
            <Link
              to="/analysis"
              className="underline decoration-signal decoration-2 underline-offset-4"
            >
              Open Analysis
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
