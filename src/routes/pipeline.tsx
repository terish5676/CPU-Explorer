import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Save } from "lucide-react";
import {
  parseProgram,
  simulatePipeline,
  stageAt,
  SAMPLE_PROGRAMS,
  STAGES,
  type PipelineOptions,
} from "@/lib/pipeline-sim";
import { runsStore } from "@/lib/runs-store";
import { takeHandoff } from "@/lib/handoff";
import { DataBadge, Empty, Field, Kpi, PageHeader, Sheet, Toggle } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline Simulator — CPU Performance Explorer" },
      {
        name: "description",
        content:
          "Five-stage in-order pipeline with a cycle playhead, hazards and stall accounting.",
      },
    ],
  }),
  component: PipelinePage,
});

const STAGE_BG: Record<string, string> = {
  IF: "bg-stage-if",
  ID: "bg-stage-id",
  EX: "bg-stage-ex text-[var(--stage-ex-fg)]",
  MEM: "bg-stage-mem",
  WB: "bg-stage-wb",
};

function PipelinePage() {
  const [text, setText] = useState(SAMPLE_PROGRAMS["raw"]!.text);
  const [label, setLabel] = useState(SAMPLE_PROGRAMS["raw"]!.label);
  const [opts, setOpts] = useState<PipelineOptions>({
    forwarding: true,
    singleMemoryPort: false,
    maxDynamic: 200,
  });
  const [cycle, setCycle] = useState(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const h = takeHandoff();
    if (h && (h.kind === "program" || h.kind === "asm")) {
      setText(h.text);
      setLabel(h.label);
      toast.success("Program received", { description: h.label });
    }
  }, []);

  const parsed = useMemo(() => parseProgram(text), [text]);
  const result = useMemo(() => {
    if (parsed.errors.length) return null;
    try {
      return simulatePipeline(parsed, opts);
    } catch {
      return null;
    }
  }, [parsed, opts]);
  const alt = useMemo(() => {
    if (parsed.errors.length) return null;
    try {
      return simulatePipeline(parsed, { ...opts, forwarding: !opts.forwarding });
    } catch {
      return null;
    }
  }, [parsed, opts]);

  const total = result?.totalCycles ?? 0;
  useEffect(() => {
    setCycle(1);
  }, [text, opts.forwarding, opts.singleMemoryPort, opts.maxDynamic]);
  useEffect(() => {
    if (!playing || !total) return;
    const id = setInterval(
      () =>
        setCycle((c) => {
          if (c >= total) {
            setPlaying(false);
            return c;
          }
          return c + 1;
        }),
      420,
    );
    return () => clearInterval(id);
  }, [playing, total]);

  const saveRun = () => {
    if (!result) return;
    runsStore.add({
      name: `Pipeline · ${label} · ${opts.forwarding ? "forwarding" : "no forwarding"}${opts.singleMemoryPort ? " · 1 port" : ""}`,
      kind: "pipeline",
      source: "Simulated",
      inputs: { text, ...opts },
      metrics: {
        cycles: result.totalCycles,
        instructionCount: result.instructionCount,
        cpi: result.cpi,
        stalls: result.stallCycles.total,
        dataStalls: result.stallCycles.data,
        controlStalls: result.stallCycles.control,
        structuralStalls: result.stallCycles.structural,
      },
    });
    toast.success("Run saved", { description: "Compare it in Analysis." });
  };

  return (
    <div>
      <PageHeader
        index="03"
        title="Pipeline"
        italic="simulator"
        description="An educational IF-ID-EX-MEM-WB in-order pipeline. Results update live as you edit. Drag the playhead to see which instruction sits in which stage — and why anything waits."
      >
        <DataBadge source="Simulated" />
      </PageHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-[21rem_1fr]">
        <div className="flex flex-col gap-6">
          <Sheet title="Program" tag="A">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SAMPLE_PROGRAMS).map(([k, p]) => (
                <button
                  key={k}
                  className="btn btn-ghost btn-sm"
                  title={p.note}
                  onClick={() => {
                    setText(p.text);
                    setLabel(p.label);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              className="editor mt-3 h-60"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setLabel("custom program");
              }}
              spellCheck={false}
              aria-label="Assembly program"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              R0–R7 (R0 = 0). ADD SUB AND OR ADDI LW SW BEQ BNE NOP. <code>#</code> comments,{" "}
              <code>label:</code> targets.
            </p>
            {parsed.errors.length > 0 && (
              <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-miss">
                {parsed.errors.map((e) => (
                  <li key={e}>✕ {e}</li>
                ))}
              </ul>
            )}
          </Sheet>
          <Sheet title="Hazard units" tag="B">
            <div className="space-y-4">
              <Toggle
                checked={opts.forwarding}
                onChange={(v) => setOpts((o) => ({ ...o, forwarding: v }))}
                label="Forwarding"
                hint="EX→EX and MEM→EX bypass paths"
              />
              <Toggle
                checked={opts.singleMemoryPort}
                onChange={(v) => setOpts((o) => ({ ...o, singleMemoryPort: v }))}
                label="Single memory port"
                hint="IF and MEM compete — structural hazard"
              />
              <Field label="Max dynamic instructions">
                <input
                  type="number"
                  className="field mt-1"
                  value={opts.maxDynamic}
                  min={1}
                  max={500}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      maxDynamic: Math.min(
                        500,
                        Math.max(1, Math.trunc(Number(e.target.value)) || 1),
                      ),
                    }))
                  }
                />
              </Field>
            </div>
          </Sheet>
        </div>

        <div className="min-w-0">
          {!result ? (
            <Empty>
              {parsed.errors.length
                ? "Fix the errors in the program to see the pipeline."
                : "Nothing to simulate."}
            </Empty>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  accent
                  label="Total cycles"
                  value={String(result.totalCycles)}
                  sub={
                    result.truncated
                      ? "truncated at limit"
                      : `${result.instructionCount} instructions`
                  }
                />
                <Kpi
                  label="CPI"
                  value={result.cpi.toFixed(2)}
                  sub={
                    alt
                      ? `${opts.forwarding ? "without" : "with"} forwarding: ${alt.cpi.toFixed(2)}`
                      : undefined
                  }
                />
                <Kpi label="Stall cycles" value={String(result.stallCycles.total)} />
                <Kpi
                  label="data · control · struct."
                  value={`${result.stallCycles.data}·${result.stallCycles.control}·${result.stallCycles.structural}`}
                />
              </div>

              <Sheet
                title="Datapath"
                tag="C"
                actions={
                  <button className="btn btn-sm" onClick={saveRun}>
                    <Save /> Save run
                  </button>
                }
              >
                <div className="grid grid-cols-5 gap-0 border border-ink">
                  {STAGES.map((s, i) => {
                    const d = result.dyn.find((x) => stageAt(x, cycle)?.stage === s);
                    const occ = d ? stageAt(d, cycle) : null;
                    return (
                      <div
                        key={s}
                        className={cn(
                          "relative min-h-24 p-2",
                          i > 0 && "border-l border-ink",
                          d ? STAGE_BG[s] : "",
                          occ?.stalled && "hatch",
                        )}
                      >
                        <p className="font-mono text-[10px] font-medium uppercase tracking-widest opacity-70">
                          {s}
                        </p>
                        <p className="mt-2 break-words font-mono text-[11px] leading-snug">
                          {d ? (
                            <span className={cn(occ?.stalled && "bg-paper px-0.5 text-ink")}>
                              {d.instr.text.split("#")[0]}
                            </span>
                          ) : (
                            <span className="opacity-30">bubble</span>
                          )}
                        </p>
                        {occ?.stalled && (
                          <p className="absolute bottom-1 right-1.5 font-mono text-[9px] uppercase text-signal">
                            stalled
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    className="btn btn-sm w-24"
                    onClick={() => {
                      if (cycle >= total) setCycle(1);
                      setPlaying((p) => !p);
                    }}
                  >
                    {playing ? (
                      <>
                        <Pause /> Pause
                      </>
                    ) : (
                      <>
                        <Play /> Play
                      </>
                    )}
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={total}
                    value={cycle}
                    onChange={(e) => {
                      setPlaying(false);
                      setCycle(+e.target.value);
                    }}
                    aria-label="Cycle playhead"
                  />
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    cycle <b className="text-signal">{cycle}</b>/{total}
                  </span>
                </div>
              </Sheet>

              <Sheet title="Cycle diagram" tag="D" bodyClassName="overflow-x-auto">
                <div
                  className="grid gap-px"
                  style={{ gridTemplateColumns: `13rem repeat(${total}, 1.9rem)` }}
                >
                  <div />
                  {Array.from({ length: total }, (_, c) => (
                    <button
                      key={c}
                      onClick={() => {
                        setPlaying(false);
                        setCycle(c + 1);
                      }}
                      className={cn(
                        "pb-1 text-center font-mono text-[10px]",
                        c + 1 === cycle ? "text-signal font-medium" : "text-ink-3",
                      )}
                    >
                      {c + 1}
                    </button>
                  ))}
                  {result.dyn.map((d) => (
                    <Row key={d.seq} d={d} total={total} cycle={cycle} />
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 font-mono text-[11px] text-ink-3">
                  {STAGES.map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <i
                        className={cn("inline-block h-3 w-3 border border-rule-soft", STAGE_BG[s])}
                      />
                      {s}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5">
                    <i className="hatch inline-block h-3 w-3 border border-signal" /> stalled in
                    place
                  </span>
                </div>
              </Sheet>

              <div className="grid gap-6 xl:grid-cols-2">
                <Sheet title="Hazard log" tag="E">
                  {result.dyn.every((d) => !d.stalls.length) ? (
                    <p className="text-sm text-ink-2">
                      No stalls — every instruction flowed straight through.
                    </p>
                  ) : (
                    <ul className="divide-y divide-rule-soft font-mono text-xs">
                      {result.dyn
                        .filter((d) => d.stalls.length)
                        .map((d) => (
                          <li key={d.seq} className="flex gap-3 py-2">
                            <span className="w-6 shrink-0 text-ink-3">{d.seq + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{d.instr.text.split("#")[0]}</span>
                              {d.stalls.map((s, i) => (
                                <span key={i} className="block text-ink-3">
                                  +{s.cycles} · {s.reason}
                                </span>
                              ))}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </Sheet>
                <Sheet title="Registers" tag="F">
                  <div className="grid grid-cols-4 gap-px bg-rule-soft font-mono text-xs">
                    {result.registers.map((v, i) => (
                      <div key={i} className="bg-paper px-3 py-3">
                        <span className="text-ink-3">R{i}</span>
                        <span className="numeral ml-2 text-3xl">{v}</span>
                      </div>
                    ))}
                  </div>
                </Sheet>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  d,
  total,
  cycle,
}: {
  d: NonNullable<ReturnType<typeof simulatePipeline>>["dyn"][number];
  total: number;
  cycle: number;
}) {
  const extra = d.stalls.reduce((n, s) => n + s.cycles, 0);
  return (
    <>
      <div className="flex items-center gap-2 pr-2 font-mono text-xs">
        <span className="w-6 shrink-0 text-right text-ink-3">{d.seq + 1}</span>
        <span className="truncate" title={d.instr.text}>
          {d.instr.text.split("#")[0]}
        </span>
        {extra > 0 && (
          <span
            className="ml-auto shrink-0 border border-signal px-1 text-[10px] text-signal"
            title={d.stalls.map((s) => s.reason).join("; ")}
          >
            +{extra}
          </span>
        )}
      </div>
      {Array.from({ length: total }, (_, c) => {
        const occ = stageAt(d, c + 1);
        if (!occ) return <div key={c} className={cn(c + 1 === cycle && "bg-signal/10")} />;
        return (
          <div
            key={c}
            title={`Cycle ${c + 1}: ${occ.stage}${occ.stalled ? " (stalled)" : ""}`}
            className={cn(
              "flex h-7 items-center justify-center font-mono text-[10px] font-medium transition-opacity",
              STAGE_BG[occ.stage],
              occ.stalled && "hatch outline outline-1 -outline-offset-1 outline-signal",
              c + 1 > cycle ? "opacity-25" : "",
              c + 1 === cycle && "ring-2 ring-signal ring-offset-1 ring-offset-paper",
            )}
          >
            {occ.stage}
          </div>
        );
      })}
    </>
  );
}
