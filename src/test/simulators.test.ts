import { describe, expect, it } from "vitest";
import {
  parseTrace,
  simulateCache,
  validateCacheConfig,
  SAMPLE_TRACES,
  type CacheConfig,
} from "@/lib/cache-sim";
import { parseProgram, simulatePipeline, SAMPLE_PROGRAMS } from "@/lib/pipeline-sim";
import { analyzeLocality, generateTrace } from "@/lib/memory-analysis";
import { compareRuns } from "@/lib/bottleneck";
import { parseAsm, countCategories } from "@/lib/asm-parser";
import type { SavedRun } from "@/lib/runs-store";

const cfg = (o: Partial<CacheConfig> = {}): CacheConfig => ({
  cacheSize: 256,
  blockSize: 16,
  ways: 1,
  policy: "LRU",
  seed: 1,
  ...o,
});
const trace = (name: string) => parseTrace(SAMPLE_TRACES[name]!.text).entries;

describe("cache simulator", () => {
  it("sequential walk: one compulsory miss per 16 B block (4-byte reads)", () => {
    const r = simulateCache(cfg(), trace("sequential"));
    expect(r.accesses).toHaveLength(32);
    expect(r.misses).toBe(8);
    expect(r.hits).toBe(24);
    expect(r.compulsoryMisses).toBe(8);
  });
  it("conflict ping-pong thrashes direct-mapped but fits 2-way", () => {
    const dm = simulateCache(cfg(), trace("conflict"));
    const sa = simulateCache(cfg({ ways: 2 }), trace("conflict"));
    expect(dm.hits).toBe(0);
    expect(sa.misses).toBeLessThan(dm.misses);
  });
  it("LRU evicts the least-recently used line", () => {
    const t = parseTrace("R 0\nR 256\nR 0\nR 512\nR 256").entries; // 1 set x 2 ways would need tiny cfg
    const r = simulateCache(cfg({ cacheSize: 32, blockSize: 16, ways: 2 }), t);
    expect(r.accesses[3]!.evictedBlock).toBe(16); // block of 256 is LRU, not block 0
    expect(r.accesses[4]!.hit).toBe(false);
  });
  it("is deterministic, including Random policy", () => {
    const c = cfg({ policy: "Random", ways: 2 });
    const t = generateTrace({
      kind: "random",
      base: 0,
      count: 200,
      stride: 4,
      writeEvery: 0,
      range: 4096,
      seed: 3,
    });
    expect(simulateCache(c, t).misses).toBe(simulateCache(c, t).misses);
  });
  it("validates geometry", () => {
    expect(validateCacheConfig(cfg({ blockSize: 12 }))).not.toHaveLength(0);
    expect(validateCacheConfig(cfg({ cacheSize: 16, blockSize: 32 }))).not.toHaveLength(0);
    expect(validateCacheConfig(cfg())).toHaveLength(0);
  });
  it("parses hex, decimal, ops, comments and reports bad lines", () => {
    const p = parseTrace("R 0x10\nW 32 # c\n64\nzzz");
    expect(p.entries.map((e) => [e.op, e.address])).toEqual([
      ["R", 16],
      ["W", 32],
      ["R", 64],
    ]);
    expect(p.errors).toHaveLength(1);
  });
});

describe("pipeline simulator", () => {
  const run = (key: string, forwarding: boolean) =>
    simulatePipeline(parseProgram(SAMPLE_PROGRAMS[key]!.text), {
      forwarding,
      singleMemoryPort: false,
      maxDynamic: 200,
    });
  it("independent instructions: no stalls, ideal fill (N+4 cycles)", () => {
    const r = run("independent", true);
    expect(r.stallCycles.total).toBe(0);
    expect(r.totalCycles).toBe(r.instructionCount + 4);
  });
  it("forwarding strictly reduces stalls on a RAW chain; load-use still stalls", () => {
    const on = run("raw", true),
      off = run("raw", false);
    expect(off.stallCycles.total).toBeGreaterThan(on.stallCycles.total);
    expect(on.stallCycles.data).toBeGreaterThanOrEqual(1);
  });
  it("branches cost control stalls and the loop computes the right result", () => {
    const r = run("loop", true);
    expect(r.stallCycles.control).toBeGreaterThan(0);
    expect(r.registers[2]).toBe(6); // 3+2+1
  });
  it("single memory port creates structural stalls", () => {
    const r = simulatePipeline(parseProgram(SAMPLE_PROGRAMS["memory"]!.text), {
      forwarding: true,
      singleMemoryPort: true,
      maxDynamic: 200,
    });
    expect(r.stallCycles.structural).toBeGreaterThan(0);
  });
  it("rejects bad programs with line numbers", () => {
    const p = parseProgram("ADD R1, R2\nFOO R1\nBNE R1, R0, nowhere");
    expect(p.errors.length).toBe(3);
    expect(p.errors[0]).toMatch(/^Line 1/);
  });
});

describe("memory analysis", () => {
  it("classifies sequential vs strided vs random", () => {
    const seq = analyzeLocality(
      generateTrace({
        kind: "sequential",
        base: 0,
        count: 100,
        stride: 4,
        writeEvery: 0,
        range: 0,
        seed: 1,
      }),
    );
    const str = analyzeLocality(
      generateTrace({
        kind: "strided",
        base: 0,
        count: 100,
        stride: 256,
        writeEvery: 0,
        range: 0,
        seed: 1,
      }),
    );
    const rnd = analyzeLocality(
      generateTrace({
        kind: "random",
        base: 0,
        count: 200,
        stride: 4,
        writeEvery: 0,
        range: 65536,
        seed: 1,
      }),
    );
    expect(seq.pattern).toBe("Sequential");
    expect(str.pattern).toBe("Strided");
    expect(rnd.pattern).toBe("Irregular");
    expect(seq.spatialLocality).toBeGreaterThan(0.9);
    expect(str.spatialLocality).toBe(0);
  });
});

describe("bottleneck rule engine", () => {
  const mk = (
    name: string,
    metrics: Record<string, number>,
    kind: SavedRun["kind"] = "cache",
    source: SavedRun["source"] = "User trace",
  ): SavedRun => ({ id: name, name, kind, source, createdAt: 0, inputs: {}, metrics });
  it("R1 fires on a ≥5pp miss-ratio rise", () => {
    const f = compareRuns(mk("a", { missRatio: 0.1 }), mk("b", { missRatio: 0.5 }));
    expect(f.some((x) => x.rule === "R1" && x.severity === "high")).toBe(true);
  });
  it("R4 never calls modelled timing 'Observed'", () => {
    const f = compareRuns(
      mk("a", { executionTimeMs: 2 }, "code", "Simulated"),
      mk("b", { executionTimeMs: 6 }, "code", "Simulated"),
    );
    expect(f.find((x) => x.rule === "R4")!.evidence).toBe("Simulated");
  });
  it("reports no-difference when nothing crosses a threshold", () => {
    expect(compareRuns(mk("a", { missRatio: 0.2 }), mk("b", { missRatio: 0.21 }))[0]!.rule).toBe(
      "—",
    );
  });
});

describe("assembly classifier", () => {
  it("categorises instructions and ignores labels/comments", () => {
    const c = countCategories(
      parseAsm(".L1:\n  mov eax, 1 # x\n  add eax, 2\n  xor eax, eax\n  jl .L1\n"),
    );
    expect(c).toMatchObject({ "load/store": 1, arithmetic: 1, logic: 1, control: 1 });
  });
});
