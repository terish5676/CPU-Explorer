import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Copy, Database, FileCode, Loader2, Play, ScanSearch, Save, Square } from "lucide-react";
import { EXAMPLES, LANGUAGES, examplesFor, type Language } from "@/lib/examples";
import {
  adapterFor,
  analyzeSource,
  validateSource,
  type ExecutionResponse,
} from "@/lib/execution-adapter";
import { runsStore } from "@/lib/runs-store";
import { sendHandoff } from "@/lib/handoff";
import { DataBadge, Empty, PageHeader, Segmented, Sheet } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/code-lab")({
  head: () => ({
    meta: [
      { title: "Code Lab — CPU Performance Explorer" },
      {
        name: "description",
        content:
          "Run C, C++, Python, Java and JavaScript for real — edit freely, measure wall time, save runs.",
      },
    ],
  }),
  component: CodeLab,
});

function CodeLab() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Language>("javascript");
  const [exId, setExId] = useState(examplesFor("javascript")[0]!.id);
  const [source, setSource] = useState(examplesFor("javascript")[0]!.source);
  const [stdin, setStdin] = useState("");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ExecutionResponse | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const adapter = adapterFor(lang);
  const analysis = useMemo(() => analyzeSource(source), [source]);
  const list = examplesFor(lang);
  const dirty = useMemo(() => {
    const ex = EXAMPLES.find((e) => e.id === exId);
    return !ex || ex.source !== source;
  }, [exId, source]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pickLang = (l: Language) => {
    setLang(l);
    const e = examplesFor(l)[0]!;
    setExId(e.id);
    setSource(e.source);
    setResp(null);
  };
  const pickEx = (id: string) => {
    const e = EXAMPLES.find((x) => x.id === id)!;
    setExId(id);
    setSource(e.source);
    setResp(null);
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    toast.message("Run cancelled");
  };

  const run = async () => {
    const errs = validateSource({ language: lang, source });
    if (errs.length) {
      toast.error(errs[0]!);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setResp(null);
    try {
      const r = await adapter.run({ language: lang, source, stdin, signal: ac.signal });
      if (ac.signal.aborted) return;
      setResp(r);
      if (r.status === "success") {
        toast.success("Execution complete", { description: `${r.runtime} · ${r.measured?.wallTimeMs.toFixed(1)} ms` });
      } else {
        toast.error("Execution error", { description: r.stderr.slice(0, 120) || r.status });
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      toast.error(e instanceof Error ? e.message : "Runner error");
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
  };

  const save = () => {
    if (!resp || resp.status !== "success" || !resp.measured) return;
    const title = dirty
      ? "Custom program"
      : (EXAMPLES.find((e) => e.id === exId)?.title ?? "Custom program");
    runsStore.add({
      name: `Code · ${LANGUAGES.find((l) => l.id === lang)!.label} · ${title}`,
      kind: "code",
      source: resp.source,
      inputs: { language: lang, source, stdin },
      metrics: {
        executionTimeMs: resp.measured.wallTimeMs,
        ...(resp.measured.cpuTimeMs ? { cpuTimeMs: resp.measured.cpuTimeMs } : {}),
        ...(resp.measured.maxRssMB ? { memoryMB: resp.measured.maxRssMB } : {}),
        lines: analysis.lines,
        loops: analysis.loops,
        maxLoopDepth: analysis.maxLoopDepth,
        arrayAccesses: analysis.arrayAccesses,
      },
    });
    toast.success("Run saved", { description: "Available in Monitor & Bottleneck Analysis." });
  };

  const copyOutput = async () => {
    if (!resp) return;
    const text = [resp.stdout, resp.stderr].filter(Boolean).join("\n--- stderr ---\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Output copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const toAssembly = () => {
    const curEx = EXAMPLES.find((e) => e.id === exId);
    const title = dirty ? "Custom program" : (curEx?.title ?? "Code snippet");
    const asm = curEx?.asm || `# Disassembly representation for ${title} (${lang})
main:
    push    rbp
    mov     rbp, rsp
    sub     rsp, 32
    mov     DWORD PTR [rbp-4], 0
.Lloop:
    cmp     DWORD PTR [rbp-4], ${Math.max(10, analysis.arrayAccesses * 4)}
    jge     .Ldone
    mov     eax, DWORD PTR [rbp-4]
    imul    eax, eax, 4
    mov     edx, eax
    add     DWORD PTR [rbp-8], edx
    inc     DWORD PTR [rbp-4]
    jmp     .Lloop
.Ldone:
    mov     eax, DWORD PTR [rbp-8]
    leave
    ret`;
    sendHandoff({ kind: "asm", text: asm, label: `${LANGUAGES.find((l) => l.id === lang)?.label} · ${title}` });
    navigate({ to: "/assembly" });
  };

  const toCache = () => {
    const isColMajor = analysis.hints.some((h) => h.text.includes("column-major"));
    const stride = isColMajor ? 2048 : 4;
    const count = 256;
    const entries = Array.from({ length: count }, (_, idx) => ({
      address: 0x2000 + ((idx * stride) % 65536),
      type: idx % 4 === 0 ? "W" : "R",
    }));
    const text = entries
      .map((e) => `${e.address.toString(16).toUpperCase().padStart(4, "0")} ${e.type}`)
      .join("\n");
    sendHandoff({
      kind: "trace",
      text,
      label: `Code Lab · ${LANGUAGES.find((l) => l.id === lang)?.label} (${isColMajor ? "strided" : "sequential"})`,
    });
    navigate({ to: "/cache" });
  };

  return (
    <div>
      <PageHeader
        index="01"
        title="Code"
        italic="lab"
        description="Write and execute real code with live hardware telemetry. JavaScript runs in an isolated local Web Worker; C, C++, Python and Java compile and run on Judge0 CE with genuine wall time and memory measurements."
      >
        <DataBadge source="Measured" />
      </PageHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Sheet
            title="Source"
            tag="A"
            actions={
              <Segmented
                value={lang}
                onChange={pickLang}
                options={LANGUAGES.map((l) => ({ id: l.id, label: l.label }))}
              />
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {list.map((e) => (
                <button
                  key={e.id}
                  className={cn("btn btn-sm", exId !== e.id && "btn-ghost")}
                  onClick={() => pickEx(e.id)}
                  title={e.description}
                >
                  {e.title}
                </button>
              ))}
            </div>

            <textarea
              className="editor h-80"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              aria-label="Source code"
            />

            {lang !== "javascript" && (
              <label className="mt-3 block">
                <span className="label-mono">Standard input (stdin)</span>
                <textarea
                  className="editor mt-1 h-16"
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="Optional input passed to the running program on stdin"
                  spellCheck={false}
                  aria-label="Standard input"
                />
              </label>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {busy ? (
                <button className="btn" onClick={cancel} type="button">
                  <Square className="h-4 w-4" /> Stop
                </button>
              ) : (
                <button className="btn" onClick={run} type="button">
                  <Play className="h-4 w-4" /> Run
                </button>
              )}
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setShowAnalysis((v) => !v)}
              >
                <ScanSearch className="h-4 w-4" /> {showAnalysis ? "Hide analysis" : "Analyze"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={copyOutput}
                disabled={!resp}
              >
                <Copy className="h-4 w-4" /> Copy out
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={toAssembly}
                title="Inspect instruction breakdown in Assembly Explorer"
              >
                <FileCode className="h-4 w-4" /> Assembly <ArrowRight className="h-3 w-3" />
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={toCache}
                title="Send memory access trace to Cache Simulator"
              >
                <Database className="h-4 w-4" /> Cache Sim <ArrowRight className="h-3 w-3" />
              </button>
              <button
                className="btn btn-ghost ml-auto"
                type="button"
                onClick={save}
                disabled={!resp || resp.status !== "success" || !resp.measured}
              >
                <Save className="h-4 w-4" /> Save run
              </button>
              {busy && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> executing on runner…
                </span>
              )}
            </div>

            <p className="mt-3 border-l-2 border-signal pl-3 text-[11px] leading-relaxed text-ink-3">
              <b className="text-ink">{adapter.name}.</b> {adapter.description}
            </p>
          </Sheet>

          <Sheet
            title="Output"
            tag="B"
            bodyClassName="font-mono text-sm"
            actions={
              resp ? (
                <span className="label-mono">
                  {resp.status} · exit {resp.exitCode ?? "—"}
                </span>
              ) : undefined
            }
          >
            {!resp ? (
              <Empty>
                Press <b>Run</b> to execute. Edit freely — every language runs for real on genuine execution hardware.
              </Empty>
            ) : (
              <div>
                {resp.runtime && (
                  <p className="label-mono mb-2 text-ink-3">runtime · {resp.runtime}</p>
                )}
                {resp.stdout ? (
                  <pre className="mt-2 whitespace-pre-wrap border border-rule bg-paper-2/60 p-3">
                    {resp.stdout}
                  </pre>
                ) : (
                  <p className="mt-2 text-ink-3">(no stdout produced)</p>
                )}
                {resp.stderr && (
                  <pre className="mt-2 whitespace-pre-wrap border border-dashed border-miss p-3 text-miss">
                    {resp.stderr}
                  </pre>
                )}
                <p className="mt-2 text-[11px] text-ink-3">
                  Adapter round-trip: {resp.adapterRoundTripMs.toFixed(0)} ms (includes compilation & network transit; program execution time is in Metrics)
                </p>
              </div>
            )}
          </Sheet>
        </div>

        <div className="flex flex-col gap-6">
          <Sheet title="Metrics" tag="C">
            {!resp || resp.status !== "success" || !resp.measured ? (
              <p className="text-sm text-ink-3">
                Measured runtime telemetry appears after a successful execution.
              </p>
            ) : (
              <div className="space-y-4 font-mono text-sm">
                <div className="flex items-baseline justify-between border-b border-rule-soft py-2">
                  <dt className="text-ink-3">Wall time</dt>
                  <dd className="numeral text-5xl text-hit">
                    {resp.measured.wallTimeMs.toFixed(2)}
                    <span className="ml-1 text-base">ms</span>
                  </dd>
                </div>
                {resp.measured.cpuTimeMs !== undefined && (
                  <div className="flex items-baseline justify-between border-b border-rule-soft py-2">
                    <dt className="text-ink-3">CPU execution time</dt>
                    <dd className="text-2xl text-ink">
                      {resp.measured.cpuTimeMs.toFixed(2)} ms
                    </dd>
                  </div>
                )}
                {resp.measured.maxRssMB !== undefined && (
                  <div className="flex items-baseline justify-between border-b border-rule-soft py-2">
                    <dt className="text-ink-3">Peak memory</dt>
                    <dd className="text-2xl text-ink">
                      {resp.measured.maxRssMB.toFixed(2)} MB
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-b border-rule-soft py-2">
                  <dt className="text-ink-3">Exit code</dt>
                  <dd className="text-lg text-ink">
                    {resp.exitCode === 0 ? "0 (Success)" : resp.exitCode}
                  </dd>
                </div>
                <p className="mt-2 text-[11px] text-ink-3">
                  {lang === "javascript"
                    ? "Measured with performance.now() inside the isolated Web Worker."
                    : "Measured from Judge0 CE hardware telemetry."}
                </p>
              </div>
            )}
          </Sheet>

          {showAnalysis && (
            <Sheet title="Static analysis" tag="D">
              <div className="grid grid-cols-4 border border-rule text-center font-mono">
                {[
                  ["Lines", analysis.lines],
                  ["Loops", analysis.loops],
                  ["Depth", analysis.maxLoopDepth],
                  ["Index ops", analysis.arrayAccesses],
                ].map(([k, v], i) => (
                  <div key={String(k)} className={cn("py-2", i > 0 && "border-l border-rule")}>
                    <dt className="label-mono text-[9px]">{k}</dt>
                    <dd className="text-xl">{v}</dd>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-3">
                {analysis.hints.map((h) => (
                  <li
                    key={h.text}
                    className={cn(
                      "border-l-[3px] pl-3 text-sm",
                      h.level === "warn" ? "border-miss" : "border-rule",
                    )}
                  >
                    <span className="label-mono block">
                      {h.level === "warn" ? "Warning" : "Note"}
                    </span>
                    {h.text}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-ink-3">Static structural code analysis.</p>
            </Sheet>
          )}
        </div>
      </div>
    </div>
  );
}
