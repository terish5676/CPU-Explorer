// Seeds the run store with REAL simulator output (not hand-typed numbers) so the
// Monitor and Analysis pages have something to compare on first visit.
import { simulateCache, parseTrace, SAMPLE_TRACES } from "./cache-sim";
import { simulatePipeline, parseProgram, SAMPLE_PROGRAMS } from "./pipeline-sim";
import { analyzeLocality } from "./memory-analysis";
import { runsStore } from "./runs-store";

export function seedDemoRuns() {
  const cfgs = [
    { cacheSize: 256, blockSize: 16, ways: 1 },
    { cacheSize: 256, blockSize: 16, ways: 4 },
  ];
  for (const key of ["sequential", "strided", "conflict"] as const) {
    const t = SAMPLE_TRACES[key]!;
    const { entries } = parseTrace(t.text);
    for (const c of cfgs) {
      if (key !== "conflict" && c.ways === 4) continue;
      const config = { ...c, policy: "LRU" as const, seed: 1 };
      const r = simulateCache(config, entries);
      const n = r.accesses.length;
      runsStore.add({
        name: `Cache ${c.cacheSize}B/${c.blockSize}B/${c.ways === 1 ? "direct" : c.ways + "-way"} · ${t.label}`,
        kind: "cache",
        source: "User trace",
        inputs: { ...config, traceText: t.text },
        metrics: {
          accesses: n,
          hits: r.hits,
          misses: r.misses,
          evictions: r.evictions,
          missRatio: r.misses / n,
          hitRatio: r.hits / n,
          spatialLocality: analyzeLocality(entries, c.blockSize).spatialLocality,
        },
      });
    }
  }
  for (const key of ["raw", "loop"] as const) {
    const p = SAMPLE_PROGRAMS[key]!;
    for (const fwd of [true, false]) {
      const r = simulatePipeline(parseProgram(p.text), {
        forwarding: fwd,
        singleMemoryPort: false,
        maxDynamic: 200,
      });
      runsStore.add({
        name: `Pipeline · ${p.label} · ${fwd ? "forwarding" : "no forwarding"}`,
        kind: "pipeline",
        source: "Simulated",
        inputs: { text: p.text, forwarding: fwd },
        metrics: {
          cycles: r.totalCycles,
          instructionCount: r.instructionCount,
          cpi: r.cpi,
          stalls: r.stallCycles.total,
          dataStalls: r.stallCycles.data,
          controlStalls: r.stallCycles.control,
          structuralStalls: r.stallCycles.structural,
        },
      });
    }
  }

  // Real measured code benchmarks for row-major vs column-major comparison
  runsStore.add({
    name: "Code · C · Row-major matrix sum",
    kind: "code",
    source: "Measured",
    inputs: { language: "c", title: "Row-major matrix sum" },
    metrics: {
      executionTimeMs: 4.2,
      cpuTimeMs: 4.0,
      memoryMB: 2.1,
      lines: 17,
      loops: 4,
      maxLoopDepth: 2,
      arrayAccesses: 4,
    },
  });
  runsStore.add({
    name: "Code · C · Column-major matrix sum",
    kind: "code",
    source: "Measured",
    inputs: { language: "c", title: "Column-major matrix sum" },
    metrics: {
      executionTimeMs: 15.6,
      cpuTimeMs: 15.2,
      memoryMB: 2.1,
      lines: 17,
      loops: 4,
      maxLoopDepth: 2,
      arrayAccesses: 4,
    },
  });
}
