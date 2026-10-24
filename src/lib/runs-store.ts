import { useSyncExternalStore } from "react";
import type { DataSource } from "./execution-adapter";

export type RunKind = "code" | "cache" | "pipeline" | "memory";

export interface SavedRun {
  id: string;
  name: string;
  kind: RunKind;
  source: DataSource;
  createdAt: number;
  inputs: Record<string, unknown>;
  metrics: Record<string, number>;
}

const KEY = "cpu-explorer.runs.v1";
const listeners = new Set<() => void>();
let cache: SavedRun[] | null = null;
const EMPTY: SavedRun[] = [];

function read(): SavedRun[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function write(runs: SavedRun[]) {
  cache = runs;
  try {
    localStorage.setItem(KEY, JSON.stringify(runs));
  } catch {
    /* storage full / disabled: keep in memory */
  }
  listeners.forEach((l) => l());
}

export const runsStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: read,
  add(run: Omit<SavedRun, "id" | "createdAt">): SavedRun {
    const r: SavedRun = {
      ...run,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    write([r, ...read()].slice(0, 200));
    return r;
  },
  remove(id: string) {
    write(read().filter((r) => r.id !== id));
  },
  rename(id: string, name: string) {
    write(read().map((r) => (r.id === id ? { ...r, name } : r)));
  },
  clear() {
    write([]);
  },
};

export function useRuns(): SavedRun[] {
  return useSyncExternalStore(runsStore.subscribe, read, () => EMPTY);
}

export const METRIC_LABELS: Record<string, { label: string; unit?: string; pct?: boolean }> = {
  executionTimeMs: { label: "Execution time", unit: "ms" },
  cpuTimeMs: { label: "Process CPU time", unit: "ms" },
  cpuUtilization: { label: "CPU utilization", unit: "%" },
  memoryMB: { label: "Memory usage", unit: "MB" },
  instructions: { label: "Instructions (modeled)" },
  cacheMissRatio: { label: "Cache miss ratio", pct: true },
  hitRatio: { label: "Hit ratio", pct: true },
  missRatio: { label: "Miss ratio", pct: true },
  hits: { label: "Hits" },
  misses: { label: "Misses" },
  evictions: { label: "Evictions" },
  accesses: { label: "Accesses" },
  cycles: { label: "Total cycles" },
  instructionCount: { label: "Instructions" },
  cpi: { label: "CPI" },
  stalls: { label: "Stall cycles" },
  dataStalls: { label: "Data-hazard stalls" },
  controlStalls: { label: "Control stalls" },
  structuralStalls: { label: "Structural stalls" },
  spatialLocality: { label: "Spatial locality", pct: true },
  temporalReuse: { label: "Temporal reuse", pct: true },
  uniqueBlocks: { label: "Unique blocks" },
  loadStoreShare: { label: "Load/Store share", pct: true },
  arithmeticCount: { label: "Arithmetic instructions" },
  loadStoreCount: { label: "Memory instructions" },
  controlCount: { label: "Control flow instructions" },
  logicCount: { label: "Logic instructions" },
  lines: { label: "Source lines" },
  loops: { label: "Loop count" },
  maxLoopDepth: { label: "Max loop nesting depth" },
  arrayAccesses: { label: "Array indexing operations" },
};

export function fmtMetric(key: string, v: number): string {
  const m = METRIC_LABELS[key];
  if (m?.pct) return `${(v * 100).toFixed(1)}%`;
  const s = Number.isInteger(v) ? v.toLocaleString() : v.toFixed(v < 10 ? 2 : 1);
  return m?.unit ? `${s} ${m.unit}` : s;
}
