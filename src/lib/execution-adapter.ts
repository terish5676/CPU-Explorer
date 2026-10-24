// Execution adapters: every language runs for real.
// - JavaScript → sandboxed Web Worker (local, measured)
// - C / C++ / Python / Java → Judge0 CE remote compile+run (measured)

import type { Language } from "./examples";
import { runJavaScript } from "./js-runner";
import { runOnJudge0 } from "./judge0-runner";

export type DataSource = "Measured" | "User trace" | "Simulated";

export interface ExecutionRequest {
  language: Language;
  source: string;
  stdin?: string;
  signal?: AbortSignal;
}

export interface ExecutionResponse {
  status: "success" | "error" | "unsupported";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  source: DataSource;
  measured?: { wallTimeMs: number; cpuTimeMs?: number; maxRssMB?: number };
  exampleId?: string;
  runtime?: string;
  /** Observed browser-side round-trip of the adapter call itself — NOT program time. */
  adapterRoundTripMs: number;
}

export interface ExecutionAdapter {
  id: string;
  name: string;
  connected: boolean;
  description: string;
  run(req: ExecutionRequest): Promise<ExecutionResponse>;
}

/** Real in-browser execution for JavaScript (sandboxed Web Worker, 5 s timeout). */
export const browserJsAdapter: ExecutionAdapter = {
  id: "browser-js",
  name: "Browser sandbox (Web Worker)",
  connected: true,
  description:
    "JavaScript runs for real in a throwaway Web Worker with no DOM or storage access and a 5 s hard timeout. Wall time is measured with performance.now().",
  async run(req) {
    const t0 = performance.now();
    if (req.signal?.aborted) {
      return {
        status: "error",
        stdout: "",
        stderr: "Run cancelled.",
        exitCode: null,
        source: "Measured",
        adapterRoundTripMs: performance.now() - t0,
      };
    }
    const r = await runJavaScript(req.source, 5000, req.signal);
    return {
      status: r.ok ? "success" : "error",
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.ok ? 0 : 1,
      source: "Measured",
      measured: { wallTimeMs: r.wallTimeMs },
      runtime: "Web Worker · ES2022",
      adapterRoundTripMs: performance.now() - t0,
    };
  },
};

/** Real remote compile+run for C, C++, Python and Java via Judge0 CE. */
export const judge0Adapter: ExecutionAdapter = {
  id: "judge0",
  name: "Live runner (Judge0 CE)",
  connected: true,
  description:
    "Your source is compiled and executed on Judge0 Community Edition. Edited programs run for real; wall time comes from the runner. Requires network access.",
  async run(req) {
    const t0 = performance.now();
    if (req.language === "javascript") {
      return browserJsAdapter.run(req);
    }
    const r = await runOnJudge0(req.language, req.source, req.stdin ?? "", req.signal);
    return {
      status: r.ok ? "success" : "error",
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      source: "Measured",
      measured: {
        wallTimeMs: r.wallTimeMs,
        cpuTimeMs: r.cpuTimeMs,
        maxRssMB: r.memoryMB,
      },
      runtime: r.runtime,
      adapterRoundTripMs: performance.now() - t0,
    };
  },
};

/** Pick the adapter for a language. Every language uses a real runner. */
export const adapterFor = (language: Language): ExecutionAdapter =>
  language === "javascript" ? browserJsAdapter : judge0Adapter;

export function validateSource(req: ExecutionRequest): string[] {
  const e: string[] = [];
  if (!req.source.trim()) e.push("Source is empty.");
  if (req.source.length > 80_000) e.push("Source exceeds 80,000 characters.");
  if (
    (req.language === "c" || req.language === "cpp" || req.language === "java") &&
    !/\bmain\s*\(/.test(req.source)
  )
    e.push("No main() entry point found.");
  if (req.language === "java" && !/\bclass\s+Main\b/.test(req.source))
    e.push('Java programs must declare "public class Main".');
  return e;
}

export interface StaticAnalysis {
  lines: number;
  loops: number;
  maxLoopDepth: number;
  arrayAccesses: number;
  hints: { level: "info" | "warn"; text: string }[];
}

/** Deterministic, text-based heuristics. Not a compiler; reported as such. */
export function analyzeSource(source: string): StaticAnalysis {
  const lines = source.split("\n");
  let depth = 0,
    maxDepth = 0,
    loops = 0;
  const loopRe = /\b(for|while)\b/;
  const stack: number[] = [];
  lines.forEach((l) => {
    const indent = l.match(/^\s*/)![0].length;
    while (stack.length && indent <= stack[stack.length - 1]!) stack.pop();
    if (loopRe.test(l)) {
      loops++;
      stack.push(indent);
      depth = stack.length;
      maxDepth = Math.max(maxDepth, depth);
    }
  });
  const arrayAccesses = (source.match(/\w\s*\[[^\]]+\]/g) ?? []).length;
  const hints: StaticAnalysis["hints"] = [];
  const colMajor =
    /for\s*\(\s*int\s+j[\s\S]*?for\s*\(\s*int\s+i[\s\S]*?\[\s*i\s*\]\s*\[\s*j\s*\]/.test(source);
  if (colMajor)
    hints.push({
      level: "warn",
      text: "Inner loop varies the first index of a[i][j] — column-major traversal of a row-major array (large stride, poor spatial locality).",
    });
  if (maxDepth >= 2)
    hints.push({
      level: "info",
      text: `Nested loops detected (depth ${maxDepth}). Work is likely O(n^${maxDepth}) in the loop bounds.`,
    });
  if (/\b(malloc|new\s|\[\s*\d{5,}|1'000'000|1_000_000)/.test(source))
    hints.push({
      level: "info",
      text: "Large allocation detected — working set may exceed L1/L2 cache.",
    });
  if (!hints.length)
    hints.push({
      level: "info",
      text: "No notable memory-access patterns detected by the heuristic rules.",
    });
  return { lines: lines.length, loops, maxLoopDepth: maxDepth, arrayAccesses, hints };
}
