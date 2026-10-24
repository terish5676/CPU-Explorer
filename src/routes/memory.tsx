import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Save } from "lucide-react";
import { parseTrace, SAMPLE_TRACES } from "@/lib/cache-sim";
import {
  analyzeLocality,
  generateTrace,
  traceToText,
  type GeneratorKind,
  type GeneratorSpec,
} from "@/lib/memory-analysis";
import { sendHandoff } from "@/lib/handoff";
import { runsStore } from "@/lib/runs-store";
import {
  DataBadge,
  Empty,
  Field,
  Kpi,
  PageHeader,
  Segmented,
  Sheet,
} from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory Explorer — CPU Performance Explorer" },
      {
        name: "description",
        content: "Generate address traces and measure stride, spatial and temporal locality.",
      },
    ],
  }),
  component: Memory,
});

function Memory() {
  const nav = useNavigate();
  const [text, setText] = useState(SAMPLE_TRACES["strided"]!.text);
  const [label, setLabel] = useState(SAMPLE_TRACES["strided"]!.label);
  const [blockSize, setBlockSize] = useState(64);
  const [gen, setGen] = useState<GeneratorSpec>({
    kind: "strided",
    base: 0,
    count: 128,
    stride: 128,
    writeEvery: 0,
    range: 4096,
    seed: 7,
  });

  const parsed = useMemo(() => parseTrace(text), [text]);
  const stats = useMemo(() => analyzeLocality(parsed.entries, blockSize), [parsed, blockSize]);
  const g = <K extends keyof GeneratorSpec>(k: K, v: GeneratorSpec[K]) =>
    setGen((s) => ({ ...s, [k]: v }));

  const generate = () => {
    setText(traceToText(generateTrace(gen)));
    setLabel(`generated ${gen.kind}`);
    toast.success(`Generated ${Math.min(1000, gen.count)} accesses`);
  };
  const save = () => {
    runsStore.add({
      name: `Memory · ${label} · ${blockSize}B blocks`,
      kind: "memory",
      source: label.startsWith("generated") ? "Simulated" : "User trace",
      inputs: { text, blockSize },
      metrics: {
        accesses: stats.total,
        spatialLocality: stats.spatialLocality,
        temporalReuse: stats.temporalReuse,
        uniqueBlocks: stats.uniqueBlocks,
      },
    });
    toast.success("Run saved");
  };
  const toCache = () => {
    sendHandoff({ kind: "trace", text, label });
    nav({ to: "/cache" });
  };

  return (
    <div>
      <PageHeader
        index="04"
        title="Memory"
        italic="explorer"
        description="See an access pattern the way a cache sees it. The scatter plots address against time; the stride histogram shows how far each access jumped; locality scores say whether a cache can possibly help."
      >
        <DataBadge source={label.startsWith("generated") ? "Simulated" : "User trace"} />
      </PageHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-[21rem_1fr]">
        <div className="flex flex-col gap-6">
          <Sheet title="Generator" tag="A">
            <Segmented<GeneratorKind>
              value={gen.kind}
              onChange={(v) => g("kind", v)}
              options={[
                { id: "sequential", label: "Seq" },
                { id: "strided", label: "Stride" },
                { id: "random", label: "Random" },
              ]}
            />
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
              <Field label="Count (≤1000)">
                <input
                  type="number"
                  className="field"
                  value={gen.count}
                  onChange={(e) => g("count", +e.target.value)}
                />
              </Field>
              <Field label="Base">
                <input
                  type="number"
                  className="field"
                  value={gen.base}
                  onChange={(e) => g("base", Math.max(0, +e.target.value))}
                />
              </Field>
              {gen.kind === "strided" && (
                <Field label="Stride (B)">
                  <input
                    type="number"
                    className="field"
                    value={gen.stride}
                    onChange={(e) => g("stride", +e.target.value)}
                  />
                </Field>
              )}
              {gen.kind === "random" && (
                <>
                  <Field label="Range (B)">
                    <input
                      type="number"
                      className="field"
                      value={gen.range}
                      onChange={(e) => g("range", +e.target.value)}
                    />
                  </Field>
                  <Field label="Seed">
                    <input
                      type="number"
                      className="field"
                      value={gen.seed}
                      onChange={(e) => g("seed", +e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="Write every Nth">
                <input
                  type="number"
                  className="field"
                  value={gen.writeEvery}
                  onChange={(e) => g("writeEvery", Math.max(0, +e.target.value))}
                />
              </Field>
            </div>
            <button className="btn mt-4 w-full" onClick={generate}>
              Generate trace
            </button>
          </Sheet>
          <Sheet title="Trace" tag="B">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SAMPLE_TRACES).map(([k, t]) => (
                <button
                  key={k}
                  className="btn btn-ghost btn-sm"
                  title={t.note}
                  onClick={() => {
                    setText(t.text);
                    setLabel(t.label);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              className="editor mt-3 h-48"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setLabel("custom trace");
              }}
              spellCheck={false}
              aria-label="Trace"
            />
            {parsed.errors.length > 0 && (
              <ul className="mt-2 max-h-20 space-y-0.5 overflow-y-auto font-mono text-[11px] text-miss">
                {parsed.errors.map((e) => (
                  <li key={e}>✕ {e}</li>
                ))}
              </ul>
            )}
            <Field label="Block size for locality" className="mt-4">
              <select
                className="field mt-1"
                value={blockSize}
                onChange={(e) => setBlockSize(+e.target.value)}
              >
                {[4, 8, 16, 32, 64, 128].map((b) => (
                  <option key={b} value={b}>
                    {b} B
                  </option>
                ))}
              </select>
            </Field>
          </Sheet>
        </div>

        <div className="min-w-0">
          {stats.total === 0 ? (
            <Empty>Paste or generate a trace to analyse it.</Empty>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  accent
                  label="Pattern"
                  value={stats.pattern}
                  sub={
                    stats.dominantStride !== null
                      ? `dominant stride ${stats.dominantStride} B · ${(stats.dominantStrideShare * 100).toFixed(0)}%`
                      : undefined
                  }
                />
                <Kpi
                  label="Spatial locality"
                  value={`${(stats.spatialLocality * 100).toFixed(0)}%`}
                  sub="within one block of previous"
                />
                <Kpi
                  label="Temporal reuse"
                  value={`${(stats.temporalReuse * 100).toFixed(0)}%`}
                  sub="block seen in last 16 accesses"
                />
                <Kpi
                  label="Unique blocks"
                  value={String(stats.uniqueBlocks)}
                  sub={`${stats.uniqueAddresses} addresses · ${stats.reads}R/${stats.writes}W`}
                />
              </div>
              <Sheet
                title="Address over time"
                tag="C"
                actions={<span className="label-mono">{stats.total} accesses</span>}
              >
                <Scatter trace={parsed.entries} blockSize={blockSize} />
              </Sheet>
              <Sheet title="Stride histogram" tag="D">
                <Strides strides={stats.strides} total={Math.max(1, stats.total - 1)} />
              </Sheet>
              <div className="flex flex-wrap gap-3">
                <button className="btn" onClick={toCache}>
                  Send to cache simulator <ArrowRight />
                </button>
                <button className="btn btn-ghost" onClick={save}>
                  <Save /> Save run
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Scatter({
  trace,
  blockSize,
}: {
  trace: { op: "R" | "W"; address: number }[];
  blockSize: number;
}) {
  const W = 760,
    H = 260,
    P = 34;
  const max = Math.max(1, ...trace.map((t) => t.address));
  const x = (i: number) => P + (i / Math.max(1, trace.length - 1)) * (W - P - 10);
  const y = (a: number) => H - P - (a / max) * (H - P - 10);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Scatter plot of address versus access index"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P} x2={W - 10} y1={y(t * max)} y2={y(t * max)} stroke="var(--rule-soft)" />
          <text
            x={P - 6}
            y={y(t * max) + 3}
            textAnchor="end"
            fontSize="9"
            fontFamily="var(--font-mono)"
            fill="var(--ink-3)"
          >
            0x{Math.round(t * max).toString(16)}
          </text>
        </g>
      ))}
      {trace.slice(1).map((t, i) => (
        <line
          key={i}
          x1={x(i)}
          y1={y(trace[i]!.address)}
          x2={x(i + 1)}
          y2={y(t.address)}
          stroke="var(--rule-soft)"
        />
      ))}
      {trace.map((t, i) =>
        t.op === "W" ? (
          <rect
            key={i}
            x={x(i) - 3}
            y={y(t.address) - 3}
            width="6"
            height="6"
            fill="var(--signal)"
          />
        ) : (
          <circle key={i} cx={x(i)} cy={y(t.address)} r="2.6" fill="var(--ink)" />
        ),
      )}
      <text
        x={W - 10}
        y={H - 8}
        textAnchor="end"
        fontSize="9"
        fontFamily="var(--font-mono)"
        fill="var(--ink-3)"
      >
        access # → · ● read ■ write · block {blockSize} B
      </text>
    </svg>
  );
}

function Strides({
  strides,
  total,
}: {
  strides: { stride: number; count: number }[];
  total: number;
}) {
  const max = Math.max(1, ...strides.map((s) => s.count));
  return (
    <ul className="space-y-2 font-mono text-xs">
      {strides.map((s, i) => (
        <li key={s.stride} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-3">
          <span className="text-right">
            {s.stride > 0 ? "+" : ""}
            {s.stride} B
          </span>
          <span className="h-5 border border-rule">
            <span
              className={cn("block h-full", i === 0 ? "bg-signal" : "bg-ink")}
              style={{ width: `${(s.count / max) * 100}%` }}
            />
          </span>
          <span className="text-ink-3">
            {s.count} · {((s.count / total) * 100).toFixed(0)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
