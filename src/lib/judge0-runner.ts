// Real remote execution via Judge0 CE (https://ce.judge0.com).
// Compiles and runs arbitrary user programs — not canned demo output.

import type { Language } from "./examples";

const JUDGE0_URL = "https://ce.judge0.com/submissions?base64_encoded=false&wait=true";

/** Judge0 CE language IDs (stable public catalog). */
const LANG_ID: Record<Exclude<Language, "javascript">, number> = {
  c: 50, // C (GCC 9.2.0)
  cpp: 54, // C++ (GCC 9.2.0)
  python: 71, // Python (3.8.1)
  java: 62, // Java (OpenJDK 13.0.1)
};

const LANG_LABEL: Record<Exclude<Language, "javascript">, string> = {
  c: "C · GCC 9.2 (Judge0)",
  cpp: "C++ · GCC 9.2 (Judge0)",
  python: "Python 3 · Judge0",
  java: "Java · OpenJDK 13 (Judge0)",
};

export interface Judge0RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  wallTimeMs: number;
  cpuTimeMs?: number;
  memoryMB?: number;
  runtime: string;
}

interface Judge0Response {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null; // seconds as string
  memory?: number | null;
  status?: { id: number; description: string };
  exit_code?: number | null;
  exit_signal?: number | null;
}

export async function runOnJudge0(
  language: Exclude<Language, "javascript">,
  source: string,
  stdin = "",
  signal?: AbortSignal,
): Promise<Judge0RunResult> {
  const t0 = performance.now();
  const runtime = LANG_LABEL[language];

  let res: Response;
  try {
    res = await fetch(JUDGE0_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal,
      body: JSON.stringify({
        source_code: source,
        language_id: LANG_ID[language],
        stdin,
        cpu_time_limit: 5,
        wall_time_limit: 10,
        memory_limit: 128000,
      }),
    });
  } catch (e) {
    if (signal?.aborted) {
      return {
        ok: false,
        stdout: "",
        stderr: "Run cancelled.",
        exitCode: null,
        wallTimeMs: performance.now() - t0,
        runtime,
      };
    }
    return {
      ok: false,
      stdout: "",
      stderr:
        e instanceof Error
          ? `Network error contacting Judge0: ${e.message}`
          : "Network error contacting Judge0.",
      exitCode: null,
      wallTimeMs: performance.now() - t0,
      runtime,
    };
  }

  const roundTripMs = performance.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      stdout: "",
      stderr: `Judge0 HTTP ${res.status}${body ? `: ${body.slice(0, 400)}` : ""}`,
      exitCode: null,
      wallTimeMs: roundTripMs,
      runtime,
    };
  }

  const data = (await res.json()) as Judge0Response;
  const statusId = data.status?.id ?? 0;
  // 3 = Accepted
  const accepted = statusId === 3;
  const wallFromRunner =
    data.time != null && data.time !== "" ? Number.parseFloat(data.time) * 1000 : NaN;
  const wallTimeMs = Number.isFinite(wallFromRunner) ? wallFromRunner : roundTripMs;
  const cpuTimeMs = Number.isFinite(wallFromRunner) ? wallFromRunner : undefined;
  const memoryMB = typeof data.memory === "number" ? Number((data.memory / 1024).toFixed(2)) : undefined;

  const stderrParts = [
    data.compile_output?.trim(),
    data.stderr?.trim(),
    data.message?.trim(),
    !accepted && data.status?.description ? `Status: ${data.status.description}` : "",
  ].filter(Boolean);

  return {
    ok: accepted,
    stdout: data.stdout ?? "",
    stderr: stderrParts.join("\n"),
    exitCode: accepted ? 0 : (data.exit_code ?? (statusId || 1)),
    wallTimeMs,
    cpuTimeMs,
    memoryMB,
    runtime,
  };
}
