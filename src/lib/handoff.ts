// Cross-tool handoff (e.g. Memory Explorer → Cache Simulator, Code Lab → Assembly Explorer) via sessionStorage.
const KEY = "cpu-explorer.handoff.v1";

export type Handoff =
  | { kind: "trace"; text: string; label: string }
  | { kind: "asm"; text: string; label: string }
  | { kind: "program"; text: string; label: string };

export function sendHandoff(h: Handoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* ignore */
  }
}

export function takeHandoff(): Handoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as Handoff;
  } catch {
    return null;
  }
}

