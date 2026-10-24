import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Trash2, Upload } from "lucide-react";
import { fmtMetric, runsStore, useRuns, type SavedRun } from "@/lib/runs-store";
import { seedDemoRuns } from "@/lib/seed";
import { provenanceOf } from "@/lib/provenance";
import { DataBadge, Empty, PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/runs")({
  head: () => ({
    meta: [
      { title: "Saved Runs — CPU Performance Explorer" },
      { name: "description", content: "Rename, export, import and prune saved runs." },
    ],
  }),
  component: Runs,
});

const isRun = (r: unknown): r is SavedRun =>
  !!r &&
  typeof r === "object" &&
  typeof (r as SavedRun).name === "string" &&
  typeof (r as SavedRun).kind === "string" &&
  typeof (r as SavedRun).metrics === "object";

function Runs() {
  const runs = useRuns();
  const file = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const exportAll = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(runs, null, 2)], { type: "application/json" }),
    );
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `cpu-explorer-runs-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const list = (Array.isArray(data) ? data : []).filter(isRun);
      if (!list.length) throw new Error("No valid runs found in file.");
      [...list].reverse().forEach((r) =>
        runsStore.add({
          name: r.name,
          kind: r.kind,
          source: r.source,
          inputs: r.inputs ?? {},
          metrics: r.metrics,
        }),
      );
      toast.success(`Imported ${list.length} runs`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid file");
    }
  };

  return (
    <div>
      <PageHeader
        index="08"
        title="Saved"
        italic="runs"
        description="Runs live in this browser’s local storage — nothing is uploaded. Export to keep them, import to restore."
      >
        <DataBadge source={provenanceOf(runs.map((r) => r.source))} />
      </PageHeader>
      <div className="mt-8 flex flex-wrap gap-2">
        <button className="btn btn-ghost" onClick={exportAll} disabled={!runs.length}>
          <Download /> Export JSON
        </button>
        <button className="btn btn-ghost" onClick={() => file.current?.click()}>
          <Upload /> Import JSON
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
        <button
          className="btn btn-ghost"
          onClick={() => {
            seedDemoRuns();
            toast.success("Added sample runs");
          }}
        >
          Add sample runs
        </button>
        <button
          className="btn ml-auto"
          onClick={() => {
            if (confirm("Delete all saved runs?")) runsStore.clear();
          }}
          disabled={!runs.length}
        >
          <Trash2 /> Clear all
        </button>
      </div>

      <div className="mt-6">
        {runs.length === 0 ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <ul className="border-t border-rule">
            {runs.map((r) => (
              <li key={r.id} className="border-b border-rule">
                <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 md:grid-cols-[5rem_1fr_9rem_8rem_auto]">
                  <span className="label-mono hidden md:block">{r.kind}</span>
                  {editing === r.id ? (
                    <input
                      autoFocus
                      className="field"
                      defaultValue={r.name}
                      onBlur={(e) => {
                        runsStore.rename(r.id, e.target.value.trim() || r.name);
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      className="truncate text-left font-display text-2xl hover:text-signal"
                      onClick={() => setEditing(r.id)}
                      title="Click to rename"
                    >
                      {r.name}
                    </button>
                  )}
                  <span className="hidden font-mono text-[11px] text-ink-3 md:block">
                    {r.source}
                  </span>
                  <span className="hidden font-mono text-[11px] text-ink-3 md:block">
                    {new Date(r.createdAt).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                    >
                      {open === r.id ? "Hide" : "Metrics"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      aria-label="Delete run"
                      onClick={() => runsStore.remove(r.id)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
                {open === r.id && (
                  <dl
                    className={cn(
                      "grid grid-cols-2 gap-px bg-rule-soft pb-0 font-mono text-xs sm:grid-cols-4",
                    )}
                  >
                    {Object.entries(r.metrics).map(([k, v]) => (
                      <div key={k} className="bg-paper px-3 py-2">
                        <dt className="label-mono">{k}</dt>
                        <dd className="mt-0.5 text-sm">{fmtMetric(k, v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
