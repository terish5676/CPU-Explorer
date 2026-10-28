// Real, isolated JavaScript execution: a throwaway Web Worker with a hard timeout.
// The worker has no DOM, no cookies and no storage. Timing is genuinely measured.
export interface JsRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  wallTimeMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

const WORKER_SRC = `
self.onmessage = (e) => {
  const payload = typeof e.data === 'object' && e.data !== null ? e.data : { code: String(e.data), stdin: '' };
  const code = payload.code || '';
  const stdin = payload.stdin || '';
  const logs = [];
  const fmt = (a) => typeof a === 'string' ? a : (typeof a === 'bigint' ? a.toString() : (() => { try { return JSON.stringify(a) } catch { return String(a) } })());
  const console = { log: (...a) => logs.push(a.map(fmt).join(' ')), error: (...a) => logs.push(a.map(fmt).join(' ')), warn: (...a) => logs.push(a.map(fmt).join(' ')) };

  // Standard input support: mock prompt, readline and input from stdin
  const inputLines = String(stdin).split('\\n');
  let inputIdx = 0;
  const prompt = (msg) => {
    if (msg) logs.push(String(msg));
    return inputLines[inputIdx++] ?? '';
  };
  const readline = () => inputLines[inputIdx++] ?? '';
  const input = (msg) => prompt(msg);

  const t0 = performance.now();
  try {
    new Function('console', 'prompt', 'readline', 'input', code)(console, prompt, readline, input);
    self.postMessage({ ok: true, out: logs.join('\\n') + (logs.length ? '\\n' : ''), err: '', ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ ok: false, out: logs.join('\\n'), err: String(err && err.stack || err), ms: performance.now() - t0 });
  }
};`;

export function runJavaScript(
  code: string,
  timeoutMs = 5000,
  signal?: AbortSignal,
  stdin = "",
): Promise<JsRunResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        ok: false,
        stdout: "",
        stderr: "Run cancelled.",
        wallTimeMs: 0,
        timedOut: false,
        cancelled: true,
      });
      return;
    }

    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    const worker = new Worker(url);
    const t0 = performance.now();
    let settled = false;

    const done = (r: JsRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(r);
    };

    const onAbort = () =>
      done({
        ok: false,
        stdout: "",
        stderr: "Run cancelled.",
        wallTimeMs: performance.now() - t0,
        timedOut: false,
        cancelled: true,
      });

    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(
      () =>
        done({
          ok: false,
          stdout: "",
          stderr: `Terminated: exceeded ${timeoutMs} ms limit.`,
          wallTimeMs: performance.now() - t0,
          timedOut: true,
          cancelled: false,
        }),
      timeoutMs,
    );

    worker.onmessage = (e) =>
      done({
        ok: e.data.ok,
        stdout: e.data.out,
        stderr: e.data.err,
        wallTimeMs: e.data.ms,
        timedOut: false,
        cancelled: false,
      });
    worker.onerror = (e) =>
      done({
        ok: false,
        stdout: "",
        stderr: e.message,
        wallTimeMs: performance.now() - t0,
        timedOut: false,
        cancelled: false,
      });

    worker.postMessage({ code, stdin });
  });
}
