import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Save, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import {
  simulateCache,
  parseTrace,
  validateCacheConfig,
  geometry,
  SAMPLE_TRACES,
  type CacheConfig,
  type CacheSimResult,
} from "@/lib/cache-sim";
import { analyzeLocality } from "@/lib/memory-analysis";
import { takeHandoff } from "@/lib/handoff";
import { runsStore } from "@/lib/runs-store";
import { DataBadge, Empty, Field, Kpi, PageHeader, Sheet } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cache")({
  head: () => ({
    meta: [
      { title: "Cache Simulator — CPU Performance Explorer" },
      {
        name: "description",
        content: "Configure a set-associative cache and scrub through every access.",
      },
    ],
  }),
  component: CachePage,
});

const CACHE_SIZES = [64, 128, 256, 512, 1024, 2048];
const BLOCK_SIZES = [4, 8, 16, 32, 64];
const WAYS = [1, 2, 4, 8];
const defaultConfig = (): CacheConfig => ({
  cacheSize: 256,
  blockSize: 16,
  ways: 1,
  policy: "LRU",
  seed: 1,
});

function Sel({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

function CachePage() {
  const [config, setConfig] = useState<CacheConfig>(defaultConfig);
  const [traceText, setTraceText] = useState(SAMPLE_TRACES["sequential"]!.text);
  const [result, setResult] = useState<CacheSimResult | null>(null);
  const [runConfig, setRunConfig] = useState<CacheConfig>(config);
  const [runLabel, setRunLabel] = useState("custom trace");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4); // accesses / second

  const errors = useMemo(() => validateCacheConfig(config), [config]);
  const geo = useMemo(() => (errors.length ? null : geometry(config)), [config, errors]);
  const parsed = useMemo(() => parseTrace(traceText), [traceText]);
  const set = <K extends keyof CacheConfig>(k: K, v: CacheConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    const h = takeHandoff();
    if (h?.kind === "trace") {
      setTraceText(h.text);
      setRunLabel(h.label);
      toast.message("Trace received from Memory Explorer", { description: h.label });
    }
  }, []);

  // playback
  useEffect(() => {
    if (!playing || !result) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= result.accesses.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, result]);

  const run = () => {
    if (errors.length) {
      toast.error(errors[0]!);
      return;
    }
    if (parsed.errors.length && !parsed.entries.length) {
      toast.error(parsed.errors[0]!);
      return;
    }
    if (!parsed.entries.length) {
      toast.error("Trace is empty.");
      return;
    }
    try {
      const r = simulateCache(config, parsed.entries);
      setResult(r);
      setRunConfig(config);
      setStep(0);
      setPlaying(true);
      toast.success(`Simulated ${r.accesses.length} accesses`, {
        description: `${r.hits} hits · ${r.misses} misses`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Simulation failed.");
    }
  };

  const saveRun = () => {
    if (!result) return;
    const n = result.accesses.length;
    const entries = parsed.entries;
    runsStore.add({
      name: `Cache ${runConfig.cacheSize}B/${runConfig.blockSize}B/${runConfig.ways === 1 ? "direct" : runConfig.ways + "-way"} ${runConfig.policy} · ${runLabel}`,
      kind: "cache",
      source: "User trace",
      inputs: { ...runConfig, traceText },
      metrics: {
        accesses: n,
        hits: result.hits,
        misses: result.misses,
        evictions: result.evictions,
        missRatio: result.misses / n,
        hitRatio: result.hits / n,
        uniqueBlocks: new Set(entries.map((t) => Math.floor(t.address / runConfig.blockSize))).size,
        spatialLocality: analyzeLocality(entries, runConfig.blockSize).spatialLocality,
      },
    });
    toast.success("Run saved", { description: "Compare it in Analysis." });
  };

  const cur = result?.accesses[step];
  const snap = result?.snapshots[step];

  return (
    <div>
      <PageHeader
        index="02"
        title="Cache"
        italic="simulator"
        description="Pick a geometry, paste an address trace, and press play. Each access is split into tag, index and offset; the grid shows exactly which line it lands in and what it pushes out."
      >
        <DataBadge source="User trace" />
      </PageHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-[21rem_1fr]">
        <div className="flex flex-col gap-6">
          <Sheet title="Geometry" tag="A">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <Field label="Capacity">
                <Sel value={config.cacheSize} onChange={(v) => set("cacheSize", +v)}>
                  {CACHE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} B
                    </option>
                  ))}
                </Sel>
              </Field>
              <Field label="Block">
                <Sel value={config.blockSize} onChange={(v) => set("blockSize", +v)}>
                  {BLOCK_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} B
                    </option>
                  ))}
                </Sel>
              </Field>
              <Field label="Associativity">
                <Sel value={config.ways} onChange={(v) => set("ways", +v)}>
                  {WAYS.map((w) => (
                    <option key={w} value={w}>
                      {w === 1 ? "Direct" : `${w}-way`}
                    </option>
                  ))}
                </Sel>
              </Field>
              <Field label="Replacement">
                <Sel
                  value={config.policy}
                  onChange={(v) => set("policy", v as CacheConfig["policy"])}
                >
                  <option>LRU</option>
                  <option>FIFO</option>
                  <option>Random</option>
                </Sel>
              </Field>
              {config.policy === "Random" && (
                <Field label="Seed" className="col-span-2">
                  <input
                    type="number"
                    className="field mt-1"
                    value={config.seed}
                    onChange={(e) => set("seed", Math.trunc(Number(e.target.value)) || 0)}
                  />
                </Field>
              )}
            </div>
            <dl className="mt-5 grid grid-cols-4 border border-rule text-center font-mono">
              {[
                ["Blocks", geo?.numBlocks],
                ["Sets", geo?.numSets],
                ["Offset", geo?.offsetBits],
                ["Index", geo?.indexBits],
              ].map(([k, v], i) => (
                <div key={String(k)} className={cn("py-2", i > 0 && "border-l border-rule")}>
                  <dt className="label-mono text-[9px]">{k}</dt>
                  <dd className="mt-0.5 text-lg">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
            {errors.length > 0 && (
              <ul className="mt-3 space-y-1 font-mono text-[11px] text-miss">
                {errors.map((e) => (
                  <li key={e}>✕ {e}</li>
                ))}
              </ul>
            )}
          </Sheet>

          <Sheet title="Address trace" tag="B">
            <p className="text-xs text-ink-3">
              One access per line — <code>R 0x1A</code>, <code>W 64</code> or a bare address.{" "}
              <code>#</code> comments.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(SAMPLE_TRACES).map(([k, t]) => (
                <button
                  key={k}
                  className="btn btn-ghost btn-sm"
                  title={t.note}
                  onClick={() => {
                    setTraceText(t.text);
                    setRunLabel(t.label);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              className="editor mt-3 h-52"
              value={traceText}
              onChange={(e) => {
                setTraceText(e.target.value);
                setRunLabel("custom trace");
              }}
              spellCheck={false}
              aria-label="Address trace"
            />
            <p className="mt-1 font-mono text-[11px] text-ink-3">
              {parsed.entries.length} accesses parsed
            </p>
            {parsed.errors.length > 0 && (
              <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11px] text-miss">
                {parsed.errors.map((e) => (
                  <li key={e}>✕ {e}</li>
                ))}
              </ul>
            )}
            <button className="btn mt-4 w-full" onClick={run} disabled={errors.length > 0}>
              <Play /> Simulate
            </button>
          </Sheet>
        </div>

        <div className="min-w-0">
          {!result || !cur || !snap ? (
            <Empty>
              Configure the cache, then press <b>Simulate</b>. The array of sets will animate here.
            </Empty>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                  accent
                  label="Hit ratio"
                  value={`${((result.hits / result.accesses.length) * 100).toFixed(1)}%`}
                  sub={`${result.hits} hits · ${result.misses} misses`}
                />
                <Kpi
                  label="Miss ratio"
                  value={`${((result.misses / result.accesses.length) * 100).toFixed(1)}%`}
                />
                <Kpi label="Evictions" value={String(result.evictions)} />
                <Kpi
                  label="Compulsory misses"
                  value={String(result.compulsoryMisses)}
                  sub="first touch of a block"
                />
              </div>

              <Sheet
                title="Playback"
                tag="C"
                actions={
                  <button className="btn btn-sm" onClick={saveRun}>
                    <Save /> Save run
                  </button>
                }
              >
                <AddressBreakdown cur={cur} cfg={runConfig} geo={result.geometry} />
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPlaying(false);
                      setStep(0);
                    }}
                    aria-label="First"
                  >
                    <SkipBack />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPlaying(false);
                      setStep((s) => Math.max(0, s - 1));
                    }}
                    aria-label="Previous"
                  >
                    <StepBack />
                  </button>
                  <button
                    className="btn btn-sm w-24"
                    onClick={() => {
                      if (step >= result.accesses.length - 1) setStep(0);
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
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPlaying(false);
                      setStep((s) => Math.min(result.accesses.length - 1, s + 1));
                    }}
                    aria-label="Next"
                  >
                    <StepForward />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPlaying(false);
                      setStep(result.accesses.length - 1);
                    }}
                    aria-label="Last"
                  >
                    <SkipForward />
                  </button>
                  <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-3">
                    speed{" "}
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={speed}
                      onChange={(e) => setSpeed(+e.target.value)}
                      className="w-24"
                      aria-label="Playback speed"
                    />{" "}
                    {speed}/s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={result.accesses.length - 1}
                  value={step}
                  onChange={(e) => {
                    setPlaying(false);
                    setStep(+e.target.value);
                  }}
                  className="mt-3"
                  aria-label="Scrub accesses"
                />
                <p className="mt-1 font-mono text-[11px] text-ink-3">
                  access {step + 1} of {result.accesses.length}
                </p>
                <SetGrid snap={snap} cur={cur} />
              </Sheet>

              <Timeline
                result={result}
                step={step}
                onPick={(i) => {
                  setPlaying(false);
                  setStep(i);
                }}
              />

              <Sheet title="Access log" tag="E" bodyClassName="p-0">
                <div className="max-h-[26rem] overflow-auto">
                  <table className="w-full font-mono text-xs">
                    <thead className="sticky top-0 bg-paper">
                      <tr className="border-b border-rule">
                        {[
                          "#",
                          "Op",
                          "Address",
                          "Block",
                          "Set",
                          "Tag",
                          "Off",
                          "Result",
                          "Way",
                          "Evicts",
                        ].map((h) => (
                          <th key={h} className="label-mono px-3 py-2 text-left font-normal">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.accesses.map((a) => (
                        <tr
                          key={a.index}
                          onClick={() => {
                            setPlaying(false);
                            setStep(a.index);
                          }}
                          className={cn(
                            "cursor-pointer border-t border-rule-soft hover:bg-paper-2",
                            a.index === step && "bg-signal text-signal-ink hover:bg-signal",
                          )}
                        >
                          <td className="px-3 py-1">{a.index + 1}</td>
                          <td className="px-3 py-1">{a.op}</td>
                          <td className="px-3 py-1">0x{a.address.toString(16).padStart(3, "0")}</td>
                          <td className="px-3 py-1">{a.block}</td>
                          <td className="px-3 py-1">{a.set}</td>
                          <td className="px-3 py-1">{a.tag}</td>
                          <td className="px-3 py-1">{a.offset}</td>
                          <td
                            className={cn(
                              "px-3 py-1 font-medium",
                              a.index !== step && (a.hit ? "text-hit" : "text-miss"),
                            )}
                          >
                            {a.hit ? "HIT" : "MISS"}
                          </td>
                          <td className="px-3 py-1">{a.way >= 0 ? a.way : "—"}</td>
                          <td className="px-3 py-1">{a.evictedBlock ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Sheet>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddressBreakdown({
  cur,
  cfg,
  geo,
}: {
  cur: CacheSimResult["accesses"][number];
  cfg: CacheConfig;
  geo: CacheSimResult["geometry"];
}) {
  const bits = Math.min(32, Math.max(12, Math.ceil(Math.log2(cur.address + 2)) + 2));
  const bin = cur.address.toString(2).padStart(bits, "0");
  const o = geo.offsetBits,
    ix = geo.indexBits,
    t = bits - o - ix;
  const tag = bin.slice(0, Math.max(0, t)),
    idx = bin.slice(Math.max(0, t), Math.max(0, t) + ix),
    off = bin.slice(bits - o);
  const seg = "px-1.5 py-1 border-r last:border-r-0 border-rule";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="label-mono">
          {cur.op === "R" ? "Read" : "Write"} · 0x{cur.address.toString(16).toUpperCase()}
        </p>
        <div
          className="mt-2 flex border border-ink font-mono text-lg tracking-[0.18em]"
          aria-label="address bits"
        >
          <span className={cn(seg, "bg-paper-2")}>{tag || "·"}</span>
          {ix > 0 && <span className={cn(seg, "bg-signal text-signal-ink")}>{idx}</span>}
          <span className={cn(seg, "hatch")}>
            <span className="bg-paper px-0.5">{off}</span>
          </span>
        </div>
        <div className="mt-1 flex font-mono text-[10px] uppercase text-ink-3">
          <span className="mr-6">tag {cur.tag}</span>
          <span className="mr-6">index {cur.set}</span>
          <span>offset {cur.offset}</span>
        </div>
      </div>
      <div
        className={cn("numeral text-7xl", cur.hit ? "text-hit" : "text-miss")}
        aria-live="polite"
      >
        {cur.hit ? "HIT" : "MISS"}
        {cur.evictedBlock !== null && (
          <span className="ml-3 block font-mono text-xs not-italic tracking-normal text-ink">
            evicted block {cur.evictedBlock}
          </span>
        )}
        {!cur.hit && cur.evictedBlock === null && (
          <span className="ml-3 block font-mono text-xs tracking-normal text-ink-3">
            filled empty way {cfg.ways > 1 ? cur.way : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function SetGrid({
  snap,
  cur,
}: {
  snap: CacheSimResult["snapshots"][number];
  cur: CacheSimResult["accesses"][number];
}) {
  const total = snap.length;
  const WINDOW = 32;
  const start = total <= WINDOW ? 0 : Math.min(Math.max(0, cur.set - WINDOW / 2), total - WINDOW);
  const rows = snap.slice(start, start + WINDOW);
  return (
    <div className="mt-5">
      <p className="label-mono mb-2">
        Cache contents · {total} sets
        {total > WINDOW && ` (showing ${start}–${start + rows.length - 1})`}
      </p>
      <div className="max-h-80 overflow-auto border border-rule">
        <table className="w-full font-mono text-xs">
          <tbody>
            {rows.map((ways, ri) => {
              const si = start + ri;
              return (
                <tr key={si} className="border-b border-rule-soft last:border-0">
                  <th
                    className={cn(
                      "w-14 border-r border-rule px-2 py-1 text-left font-normal",
                      si === cur.set ? "bg-ink text-paper" : "text-ink-3",
                    )}
                  >
                    S{si}
                  </th>
                  {ways.map((l, wi) => {
                    const isCur = si === cur.set && wi === cur.way;
                    return (
                      <td
                        key={wi}
                        className={cn(
                          "border-r border-rule-soft px-2 py-1 transition-colors duration-200",
                          isCur && (cur.hit ? "bg-hit text-paper" : "bg-signal text-signal-ink"),
                          !l.valid && !isCur && "hatch opacity-40",
                        )}
                      >
                        {l.valid ? (
                          <>
                            blk {l.block} <span className="opacity-60">· tag {l.tag}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Timeline({
  result,
  step,
  onPick,
}: {
  result: CacheSimResult;
  step: number;
  onPick: (i: number) => void;
}) {
  return (
    <Sheet title="Hit / miss strip" tag="D">
      <div className="flex flex-wrap gap-[3px]">
        {result.accesses.map((a) => (
          <button
            key={a.index}
            onClick={() => onPick(a.index)}
            title={`#${a.index + 1} ${a.op} 0x${a.address.toString(16)} — ${a.hit ? "hit" : a.evictedBlock !== null ? "miss + eviction" : "miss"}`}
            className={cn(
              "h-5 w-5 border border-transparent transition-transform hover:scale-125",
              a.hit ? "bg-hit" : a.evictedBlock !== null ? "bg-evict" : "bg-miss",
              a.index > step && "opacity-30",
              a.index === step && "outline outline-2 outline-offset-2 outline-ink",
            )}
            aria-label={`Access ${a.index + 1}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 font-mono text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 bg-hit" /> hit
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 bg-miss" /> miss
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 bg-evict" /> miss + eviction
        </span>
      </div>
    </Sheet>
  );
}
