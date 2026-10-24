import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { compareRuns, RULES, type Finding } from "@/lib/bottleneck";
import { fmtMetric, METRIC_LABELS, useRuns } from "@/lib/runs-store";
import { seedDemoRuns } from "@/lib/seed";
import { provenanceOf } from "@/lib/provenance";
import { DataBadge, Empty, PageHeader, Sheet } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/analysis")({
  head: () => ({
    meta: [
      { title: "Bottleneck Analysis — CPU Performance Explorer" },
      {
        name: "description",
        content: "A transparent rule engine that compares two runs and names the bottleneck.",
      },
    ],
  }),
  component: Analysis,
});

const SEV: Record<Finding["severity"], string> = {
  high: "bg-miss text-signal-ink",
  medium: "bg-ink text-paper",
  low: "bg-paper-2",
  info: "border border-dashed border-rule",
};

function Analysis() {
  const runs = useRuns();
  const [aId, setA] = useState("");
  const [bId, setB] = useState("");
  const a = runs.find((r) => r.id === aId) ?? runs[1];
  const b = runs.find((r) => r.id === bId) ?? runs[0];
  const findings = useMemo(() => (a && b ? compareRuns(a, b) : []), [a, b]);
  const shared = a && b ? Object.keys(a.metrics).filter((k) => k in b.metrics) : [];

  const exportReport = () => {
    if (!a || !b) return;
    const content = `# CPU Performance Explorer — Bottleneck Analysis Report
Date: ${new Date().toLocaleString()}

## Evaluated Runs
- **Baseline (Run A):** ${a.name} [${a.source} · ${a.kind}]
- **Candidate (Run B):** ${b.name} [${b.source} · ${b.kind}]

## Quantitative Metrics
${shared
  .map(
    (k) =>
      `- ${METRIC_LABELS[k]?.label ?? k}: Run A = ${fmtMetric(k, a.metrics[k]!)}, Run B = ${fmtMetric(k, b.metrics[k]!)}`,
  )
  .join("\n")}

## Diagnostic Findings & Architecture Rules
${findings
  .map(
    (f, i) => `### ${i + 1}. [Rule ${f.rule}] ${f.title}
- Severity: ${f.severity.toUpperCase()}
- Confidence: ${f.confidence}
- Telemetry Evidence: ${f.evidence}
- Detail: ${f.detail}

Next Remediation Steps:
${f.nextSteps.map((s) => `  * ${s}`).join("\n")}
`,
  )
  .join("\n")}
`;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `bottleneck-report-${new Date().toISOString().slice(0, 10)}.md`,
    });
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Analysis report exported as Markdown");
  };

  const Pick = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <label className="block">
      <span className="label-mono">{label}</span>
      <select className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <PageHeader
        index="07"
        title="Bottleneck"
        italic="analysis"
        description="Select a baseline and a candidate configuration. Six deterministic computer architecture rules pinpoint where cycles were lost and whether the regression is memory-bound, pipeline-bound, or algorithmic."
      >
        <DataBadge source={provenanceOf([a?.source, b?.source])} />
      </PageHeader>

      {runs.length < 2 ? (
        <div className="mt-8">
          <Empty>
            You need at least two saved runs to compare. Save from a simulator or Code Lab, or{" "}
            <button
              className="underline decoration-signal decoration-2 underline-offset-4"
              onClick={() => {
                seedDemoRuns();
                toast.success("Loaded baseline & candidate runs");
              }}
            >
              load sample benchmark runs
            </button>
            .
          </Empty>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Sheet
              title="Select runs"
              tag="A"
              actions={
                <button className="btn btn-ghost btn-sm" onClick={exportReport} type="button">
                  <Download className="h-3.5 w-3.5" /> Export Report
                </button>
              }
            >
              <div className="grid gap-5 md:grid-cols-2">
                {Pick({ label: "Run A · baseline", value: a?.id ?? "", onChange: setA })}
                {Pick({ label: "Run B · candidate", value: b?.id ?? "", onChange: setB })}
              </div>
              {a && b && shared.length > 0 && (
                <table className="mt-5 w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-rule text-left">
                      <th className="label-mono py-2 font-normal">Metric</th>
                      <th className="label-mono py-2 text-right font-normal">Run A (Baseline)</th>
                      <th className="label-mono py-2 text-right font-normal">Run B (Candidate)</th>
                      <th className="label-mono py-2 text-right font-normal">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shared.map((k) => {
                      const vA = a.metrics[k]!;
                      const vB = b.metrics[k]!;
                      const diff = vB - vA;
                      const pct = vA !== 0 ? ((diff / Math.abs(vA)) * 100).toFixed(1) : null;
                      return (
                        <tr key={k} className="border-b border-rule-soft">
                          <td className="py-1.5">{METRIC_LABELS[k]?.label ?? k}</td>
                          <td className="py-1.5 text-right">{fmtMetric(k, vA)}</td>
                          <td
                            className={cn(
                              "py-1.5 text-right",
                              vA !== vB && "font-bold text-signal",
                            )}
                          >
                            {fmtMetric(k, vB)}
                          </td>
                          <td className="py-1.5 text-right font-mono text-[11px] text-ink-3">
                            {diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${fmtMetric(k, diff)} ${pct ? `(${diff > 0 ? "+" : ""}${pct}%)` : ""}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Sheet>

            <section>
              <h2 className="text-4xl">Findings</h2>
              <ol className="mt-4 space-y-4">
                {findings.map((f, i) => (
                  <li
                    key={i}
                    className="panel panel-tick rise p-5"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                      <span className="border border-ink px-1.5 py-0.5">{f.rule}</span>
                      <span className={cn("px-1.5 py-0.5", SEV[f.severity])}>{f.severity}</span>
                      <span className="text-ink-3">
                        {f.evidence === "Observed" ? "Measured Telemetry" : "Architectural Evaluation"} · confidence {f.confidence}
                      </span>
                    </div>
                    <h3 className="mt-3 text-3xl leading-tight">{f.title}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{f.detail}</p>
                    <ul className="mt-4 space-y-1 border-t border-rule-soft pt-3 text-sm">
                      {f.nextSteps.map((s) => (
                        <li key={s} className="flex gap-2">
                          <span className="text-signal">→</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <Sheet title="The rulebook" tag="B" className="h-fit lg:sticky lg:top-32">
            <ul className="space-y-3 text-sm">
              {RULES.map((r) => (
                <li key={r.id} className="flex gap-3">
                  <span className="font-mono text-xs text-signal">{r.id}</span>
                  <span className="text-ink-2">{r.description}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-ink-3">
              Generate new configurations to test:{" "}
              <Link to="/cache" className="underline">
                Cache
              </Link>{" "}
              ·{" "}
              <Link to="/pipeline" className="underline">
                Pipeline
              </Link>{" "}
              ·{" "}
              <Link to="/code-lab" className="underline">
                Code Lab
              </Link>
            </p>
          </Sheet>
        </div>
      )}
    </div>
  );
}
