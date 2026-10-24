import { mulberry32, type TraceEntry } from "./cache-sim";

export interface LocalityStats {
  total: number;
  reads: number;
  writes: number;
  uniqueAddresses: number;
  uniqueBlocks: number;
  spatialLocality: number; // share of accesses within one block-distance of the previous access
  temporalReuse: number; // share whose block was touched in the previous `window` accesses
  dominantStride: number | null;
  dominantStrideShare: number;
  strides: { stride: number; count: number }[];
  pattern: "Sequential" | "Strided" | "Irregular" | "Insufficient data";
}

export function analyzeLocality(trace: TraceEntry[], blockSize = 64, window = 16): LocalityStats {
  const total = trace.length;
  const reads = trace.filter((t) => t.op === "R").length;
  const uniqueAddresses = new Set(trace.map((t) => t.address)).size;
  const blocks = trace.map((t) => Math.floor(t.address / blockSize));
  const uniqueBlocks = new Set(blocks).size;
  let spatial = 0,
    temporal = 0;
  const strideMap = new Map<number, number>();
  for (let i = 1; i < total; i++) {
    const d = trace[i].address - trace[i - 1].address;
    if (Math.abs(d) <= blockSize && d !== 0) spatial++;
    strideMap.set(d, (strideMap.get(d) ?? 0) + 1);
    const recent = blocks.slice(Math.max(0, i - window), i);
    if (recent.includes(blocks[i]!)) temporal++;
  }
  const strides = [...strideMap.entries()]
    .map(([stride, count]) => ({ stride, count }))
    .sort((a, b) => b.count - a.count);
  const denom = Math.max(1, total - 1);
  const dom = strides[0];
  const share = dom ? dom.count / denom : 0;
  let pattern: LocalityStats["pattern"] = "Insufficient data";
  if (total >= 4 && dom) {
    if (share >= 0.6 && Math.abs(dom.stride) > 0 && Math.abs(dom.stride) <= 8)
      pattern = "Sequential";
    else if (share >= 0.5) pattern = "Strided";
    else pattern = "Irregular";
  }
  return {
    total,
    reads,
    writes: total - reads,
    uniqueAddresses,
    uniqueBlocks,
    spatialLocality: total > 1 ? spatial / denom : 0,
    temporalReuse: total > 1 ? temporal / denom : 0,
    dominantStride: dom?.stride ?? null,
    dominantStrideShare: share,
    strides: strides.slice(0, 8),
    pattern,
  };
}

export type GeneratorKind = "sequential" | "strided" | "random";
export interface GeneratorSpec {
  kind: GeneratorKind;
  base: number;
  count: number;
  stride: number;
  writeEvery: number; // every Nth access is a write (0 = none)
  range: number;
  seed: number;
}

/** Explicitly-defined synthetic trace generator. Output is labelled "Simulated". */
export function generateTrace(s: GeneratorSpec): TraceEntry[] {
  const rand = mulberry32(s.seed);
  const n = Math.max(1, Math.min(1000, Math.floor(s.count)));
  return Array.from({ length: n }, (_, i) => {
    const address =
      s.kind === "sequential"
        ? s.base + i * 4
        : s.kind === "strided"
          ? s.base + i * s.stride
          : s.base + Math.floor(rand() * Math.max(1, s.range / 4)) * 4;
    return { op: s.writeEvery > 0 && (i + 1) % s.writeEvery === 0 ? "W" : "R", address };
  });
}

export const traceToText = (t: TraceEntry[]) =>
  t.map((e) => `${e.op} 0x${e.address.toString(16)}`).join("\n");
