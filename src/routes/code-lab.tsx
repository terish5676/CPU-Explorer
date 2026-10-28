import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Copy,
  Database,
  FileCode,
  Loader2,
  Play,
  ScanSearch,
  Save,
  Square,
  Terminal,
} from "lucide-react";
import { EXAMPLES, LANGUAGES, examplesFor, type Language } from "@/lib/examples";
import {
  adapterFor,
  analyzeSource,
  validateSource,
  type ExecutionResponse,
} from "@/lib/execution-adapter";
import { detectCodeInputs } from "@/lib/input-detector";
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
          "Run C, C++, Python, Java and JavaScript for real — in-terminal interactive execution with in-order input.",
      },
    ],
  }),
  component: CodeLab,
});

interface TerminalEntry {
  id: string;
  type: "command" | "stdout" | "input" | "stderr" | "system";
  text: string;
}

function CodeLab() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Language>("javascript");
  const [exId, setExId] = useState(examplesFor("javascript")[0]!.id);
  const [source, setSource] = useState(examplesFor("javascript")[0]!.source);

  // Live in-terminal execution state (inbuild only, in order, no separate input)
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [activeInput, setActiveInput] = useState("");
  const [collectedInputs, setCollectedInputs] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ExecutionResponse | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  const adapter = adapterFor(lang);
  const analysis = useMemo(() => analyzeSource(source), [source]);
  const inputDetection = useMemo(() => detectCodeInputs(lang, source), [lang, source]);
  const list = examplesFor(lang);
  const dirty = useMemo(() => {
    const ex = EXAMPLES.find((e) => e.id === exId);
    return !ex || ex.source !== source;
  }, [exId, source]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Auto-scroll terminal when new lines appear
  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [terminalEntries, currentPrompt, waitingForInput]);

  const pickLang = (l: Language) => {
    setLang(l);
    const e = examplesFor(l)[0]!;
    setExId(e.id);
    setSource(e.source);
    resetTerminal();
    setResp(null);
  };

  const pickEx = (id: string) => {
    const e = EXAMPLES.find((x) => x.id === id)!;
    setExId(id);
    setSource(e.source);
    resetTerminal();
    setResp(null);
  };

  const resetTerminal = () => {
    abortRef.current?.abort();
    setTerminalEntries([]);
    setWaitingForInput(false);
    setCurrentPrompt("");
    setActiveInput("");
    setCollectedInputs([]);
    setBusy(false);
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setWaitingForInput(false);
    setTerminalEntries((prev) => [
      ...prev,
      { id: `cancel-${Date.now()}`, type: "system", text: "[Execution stopped by user]" },
    ]);
    toast.message("Run cancelled");
  };

  /**
   * Run the compiled code on the execution engine with all inputs collected.
   */
  const executeWithInputs = async (inputs: string[], promptsToClean: string[]) => {
    const errs = validateSource({ language: lang, source });
    if (errs.length) {
      toast.error(errs[0]!);
      setBusy(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);

    const stdinString = inputs.join("\n") + "\n";

    try {
      const r = await adapter.run({
        language: lang,
        source,
        stdin: stdinString,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setResp(r);

      let stdoutText = r.stdout || "";
      const stderrText = r.stderr || "";

      // Clean out prompts that were already printed interactively in the terminal
      promptsToClean.forEach((p) => {
        if (p && p !== "> " && stdoutText.includes(p)) {
          stdoutText = stdoutText.replace(p, "");
        }
      });

      const entriesToAdd: TerminalEntry[] = [];
      if (stdoutText.trim()) {
        entriesToAdd.push({ id: `out-${Date.now()}`, type: "stdout", text: stdoutText.trimStart() });
      }
      if (stderrText.trim()) {
        entriesToAdd.push({ id: `err-${Date.now()}`, type: "stderr", text: stderrText });
      }

      const statusNote = `[Process exited with code ${r.exitCode ?? 0} in ${r.measured?.wallTimeMs.toFixed(1)} ms]`;
      entriesToAdd.push({ id: `sys-${Date.now()}`, type: "system", text: statusNote });

      setTerminalEntries((prev) => [...prev, ...entriesToAdd]);

      if (r.status === "success") {
        toast.success("Execution complete", {
          description: `${r.runtime} · ${r.measured?.wallTimeMs.toFixed(1)} ms`,
        });
      } else {
        toast.error("Execution error", { description: stderrText.slice(0, 100) || r.status });
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      toast.error(e instanceof Error ? e.message : "Runner error");
      setTerminalEntries((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: "stderr",
          text: e instanceof Error ? e.message : "Execution failed.",
        },
      ]);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
  };

  /**
   * Start a fresh execution run.
   * If code expects input, prompt for inputs interactively inside the terminal in order.
   */
  const startRun = () => {
    resetTerminal();

    const runnerLabel = adapter.name;
    const initialCommand = `$ run (${runnerLabel})`;
    setTerminalEntries([
      { id: `cmd-${Date.now()}`, type: "command", text: initialCommand },
    ]);

    const steps = inputDetection.steps;
    if (steps.length > 0) {
      // Code expects input: initiate first in-order inbuild prompt
      setWaitingForInput(true);
      setCurrentPrompt(steps[0].prompt);
      setActiveInput("");
      setTimeout(() => terminalInputRef.current?.focus(), 50);
    } else {
      // No input expected: run directly
      executeWithInputs([], []);
    }
  };

  /**
   * User pressed Enter on the active in-terminal line
   */
  const handleInputSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!waitingForInput) return;

    const typedVal = activeInput;
    // Echo the prompt + user's input directly into the terminal log
    setTerminalEntries((prev) => [
      ...prev,
      { id: `in-${Date.now()}`, type: "input", text: `${currentPrompt}${typedVal}` },
    ]);

    // Check if the user entered space-separated values that cover multiple steps
    const tokens = typedVal.trim().split(/\s+/).filter(Boolean);
    const newCollected = [...collectedInputs, typedVal];
    setCollectedInputs(newCollected);

    const totalSteps = inputDetection.steps.length;
    // If user provided multiple values on one line (e.g. "15 25"), that satisfies all steps
    const currentCount = newCollected.length;
    const valuesCount = newCollected.flatMap((s) => s.trim().split(/\s+/)).filter(Boolean).length;

    if (currentCount >= totalSteps || valuesCount >= totalSteps) {
      // All inputs provided: execute now!
      setWaitingForInput(false);
      setCurrentPrompt("");
      setActiveInput("");
      const allPrompts = inputDetection.steps.map((s) => s.prompt);
      executeWithInputs(newCollected, allPrompts);
    } else {
      // Prompt for the next input step in order
      const nextStep = inputDetection.steps[currentCount];
      setCurrentPrompt(nextStep?.prompt || "> ");
      setActiveInput("");
      setTimeout(() => terminalInputRef.current?.focus(), 50);
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
      inputs: { language: lang, source, stdin: collectedInputs.join("\n") },
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
    const text = terminalEntries.map((e) => e.text).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Terminal output copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const toAssembly = () => {
    const curEx = EXAMPLES.find((e) => e.id === exId);
    const title = dirty ? "Custom program" : (curEx?.title ?? "Code snippet");
    const asm =
      curEx?.asm ||
      `# Disassembly representation for ${title} (${lang})
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
    sendHandoff({
      kind: "asm",
      text: asm,
      label: `${LANGUAGES.find((l) => l.id === lang)?.label} · ${title}`,
    });
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
        description="Write and execute real code with live hardware telemetry. Interactive in-terminal execution — input is typed directly into the terminal in order, exactly like a regular compiler."
      >
        <DataBadge source="Measured" />
      </PageHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* ── Sheet A: Source Editor ───────────────────────────────────── */}
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
            {/* Template Selector */}
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

            {/* Code Editor */}
            <textarea
              className="editor h-80"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  startRun();
                }
              }}
              spellCheck={false}
              aria-label="Source code"
            />

            {/* Action Bar */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {busy ? (
                <button className="btn" onClick={cancel} type="button">
                  <Square className="h-4 w-4" /> Stop
                </button>
              ) : (
                <button className="btn" onClick={startRun} type="button">
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
                disabled={!terminalEntries.length}
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

          {/* ── Sheet B: Terminal (Regular compiler CLI with in-order input) ─ */}
          <Sheet
            title="Terminal"
            tag="B"
            bodyClassName="p-0 overflow-hidden"
            actions={
              <div className="flex items-center gap-2">
                {resp && (
                  <span className="label-mono">
                    {resp.status} · exit {resp.exitCode ?? 0}
                  </span>
                )}
                {terminalEntries.length > 0 && (
                  <button
                    onClick={resetTerminal}
                    className="font-mono text-[11px] text-ink-3 hover:text-ink px-1.5 py-0.5"
                    title="Clear terminal window"
                  >
                    clear
                  </button>
                )}
              </div>
            }
          >
            {/* Terminal Window */}
            <div
              ref={terminalScrollRef}
              onClick={() => {
                if (waitingForInput) terminalInputRef.current?.focus();
              }}
              className="flex min-h-[220px] max-h-[460px] flex-col overflow-y-auto bg-[#0b0c10] p-4 font-mono text-xs leading-relaxed text-[#e0e2ec] cursor-text select-text"
            >
              {terminalEntries.length === 0 && !busy && !waitingForInput ? (
                <div className="py-12 text-center text-ink-3">
                  Click <b className="text-signal">Run</b> to execute. When your code asks for input (e.g. <span className="text-[#e0e2ec]">cin &gt;&gt;</span> or <span className="text-[#e0e2ec]">input()</span>), you type it directly inside this terminal in order.
                </div>
              ) : (
                <div className="space-y-1">
                  {terminalEntries.map((entry) => {
                    if (entry.type === "command") {
                      return (
                        <div key={entry.id} className="text-ink-3 pb-1 border-b border-rule/30">
                          {entry.text}
                        </div>
                      );
                    }
                    if (entry.type === "input") {
                      return (
                        <div key={entry.id} className="text-[#38bdf8] font-bold">
                          {entry.text}
                        </div>
                      );
                    }
                    if (entry.type === "stdout") {
                      return (
                        <div key={entry.id} className="whitespace-pre-wrap text-[#34d399]">
                          {entry.text}
                        </div>
                      );
                    }
                    if (entry.type === "stderr") {
                      return (
                        <div key={entry.id} className="whitespace-pre-wrap text-[#f87171]">
                          {entry.text}
                        </div>
                      );
                    }
                    if (entry.type === "system") {
                      return (
                        <div key={entry.id} className="text-ink-3 pt-2 text-[11px]">
                          {entry.text}
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Active In-Terminal Input Prompt (inbuild only, in order) */}
                  {waitingForInput && (
                    <form
                      onSubmit={handleInputSubmit}
                      className="flex items-center text-[#38bdf8] font-bold"
                    >
                      <span className="whitespace-pre">{currentPrompt}</span>
                      <input
                        ref={terminalInputRef}
                        type="text"
                        value={activeInput}
                        onChange={(e) => setActiveInput(e.target.value)}
                        autoFocus
                        spellCheck={false}
                        className="ml-0.5 flex-1 bg-transparent font-mono text-xs text-white outline-none caret-signal"
                      />
                      <span className="animate-pulse text-signal">█</span>
                    </form>
                  )}

                  {busy && (
                    <div className="flex items-center gap-2 pt-1 text-signal">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>running...</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Terminal Status Footer */}
            {resp && (
              <div className="border-t border-rule/30 bg-[#07080a] px-3 py-1 font-mono text-[10px] text-ink-3">
                Round-trip: {resp.adapterRoundTripMs.toFixed(0)} ms · Hardware telemetry measured
              </div>
            )}
          </Sheet>
        </div>

        {/* ── Right Column: Telemetry & Static Analysis ───────────────────── */}
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
