// Set-associative cache simulator (pure, deterministic, testable).
export type ReplacementPolicy = "LRU" | "FIFO" | "Random";

export interface CacheConfig {
  cacheSize: number; // bytes
  blockSize: number; // bytes
  ways: number; // 1 = direct-mapped, numBlocks = fully associative
  policy: ReplacementPolicy;
  seed: number; // used only by Random
}

export interface TraceEntry {
  op: "R" | "W";
  address: number;
}

export interface CacheLine {
  valid: boolean;
  tag: number;
  block: number;
  insertedAt: number;
  lastUsed: number;
}

export interface AccessResult {
  index: number;
  op: "R" | "W";
  address: number;
  block: number;
  offset: number;
  set: number;
  tag: number;
  hit: boolean;
  way: number;
  evictedBlock: number | null;
}

export interface CacheGeometry {
  numBlocks: number;
  numSets: number;
  offsetBits: number;
  indexBits: number;
}

const isPow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

export function validateCacheConfig(c: CacheConfig): string[] {
  const errs: string[] = [];
  if (!isPow2(c.cacheSize)) errs.push("Cache size must be a positive power of two.");
  if (!isPow2(c.blockSize)) errs.push("Block size must be a positive power of two.");
  if (isPow2(c.cacheSize) && isPow2(c.blockSize) && c.blockSize > c.cacheSize)
    errs.push("Block size cannot exceed cache size.");
  if (!isPow2(c.ways)) errs.push("Associativity must be a power of two.");
  if (errs.length === 0) {
    const numBlocks = c.cacheSize / c.blockSize;
    if (c.ways > numBlocks)
      errs.push(`Associativity (${c.ways}) exceeds number of blocks (${numBlocks}).`);
  }
  if (c.policy === "Random" && !Number.isInteger(c.seed))
    errs.push("Random seed must be an integer.");
  return errs;
}

export function geometry(c: CacheConfig): CacheGeometry {
  const numBlocks = c.cacheSize / c.blockSize;
  const numSets = numBlocks / c.ways;
  return {
    numBlocks,
    numSets,
    offsetBits: Math.log2(c.blockSize),
    indexBits: Math.log2(numSets),
  };
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParsedTrace {
  entries: TraceEntry[];
  errors: string[];
}

/** Accepts lines like "R 0x1A", "W 64", "0x40", or "100"; '#' starts a comment. */
export function parseTrace(text: string, maxEntries = 1000): ParsedTrace {
  const entries: TraceEntry[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const parts = line.split(/[\s,]+/);
    let op: "R" | "W" = "R";
    let addrTok = parts[0];
    if (/^[RrWw]$/.test(parts[0])) {
      op = parts[0].toUpperCase() as "R" | "W";
      addrTok = parts[1];
    }
    if (!addrTok) {
      errors.push(`Line ${i + 1}: missing address.`);
      return;
    }
    const v = /^0x[0-9a-f]+$/i.test(addrTok)
      ? parseInt(addrTok, 16)
      : /^\d+$/.test(addrTok)
        ? parseInt(addrTok, 10)
        : NaN;
    if (!Number.isFinite(v) || v < 0 || v > 0xffffffff) {
      errors.push(`Line ${i + 1}: invalid address "${addrTok}".`);
      return;
    }
    if (entries.length >= maxEntries) {
      if (entries.length === maxEntries) errors.push(`Trace truncated at ${maxEntries} accesses.`);
      return;
    }
    entries.push({ op, address: v });
  });
  return { entries, errors };
}

export interface CacheSimResult {
  geometry: CacheGeometry;
  accesses: AccessResult[];
  /** snapshots[i] = cache contents AFTER access i; snapshots length = accesses.length */
  snapshots: CacheLine[][][];
  hits: number;
  misses: number;
  evictions: number;
  compulsoryMisses: number;
}

const emptySets = (g: CacheGeometry, ways: number): CacheLine[][] =>
  Array.from({ length: g.numSets }, () =>
    Array.from({ length: ways }, () => ({
      valid: false,
      tag: 0,
      block: -1,
      insertedAt: -1,
      lastUsed: -1,
    })),
  );

export function emptyCache(c: CacheConfig): CacheLine[][] {
  return emptySets(geometry(c), c.ways);
}

export function simulateCache(c: CacheConfig, trace: TraceEntry[]): CacheSimResult {
  const errs = validateCacheConfig(c);
  if (errs.length) throw new Error(errs.join(" "));
  const g = geometry(c);
  const rand = mulberry32(c.seed);
  let sets = emptySets(g, c.ways);
  const seen = new Set<number>();
  const accesses: AccessResult[] = [];
  const snapshots: CacheLine[][][] = [];
  let hits = 0,
    misses = 0,
    evictions = 0,
    compulsory = 0;

  trace.forEach((t, i) => {
    const block = Math.floor(t.address / c.blockSize);
    const offset = t.address % c.blockSize;
    const set = block % g.numSets;
    const tag = Math.floor(block / g.numSets);
    sets = sets.map((s) => s.map((l) => ({ ...l })));
    const lines = sets[set]!;
    let way = lines.findIndex((l) => l.valid && l.tag === tag);
    let evictedBlock: number | null = null;
    const hit = way >= 0;
    if (hit) {
      hits++;
      lines[way].lastUsed = i;
    } else {
      misses++;
      if (!seen.has(block)) compulsory++;
      way = lines.findIndex((l) => !l.valid);
      if (way < 0) {
        if (c.policy === "LRU") way = argMin(lines.map((l) => l.lastUsed));
        else if (c.policy === "FIFO") way = argMin(lines.map((l) => l.insertedAt));
        else way = Math.floor(rand() * c.ways);
        evictedBlock = lines[way]!.block;
        evictions++;
      }
      lines[way] = { valid: true, tag, block, insertedAt: i, lastUsed: i };
    }
    seen.add(block);
    accesses.push({
      index: i,
      op: t.op,
      address: t.address,
      block,
      offset,
      set,
      tag,
      hit,
      way,
      evictedBlock,
    });
    snapshots.push(sets);
  });

  return {
    geometry: g,
    accesses,
    snapshots,
    hits,
    misses,
    evictions,
    compulsoryMisses: compulsory,
  };
}

function argMin(xs: number[]): number {
  let b = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[b]) b = i;
  return b;
}

export const SAMPLE_TRACES: Record<string, { label: string; text: string; note: string }> = {
  sequential: {
    label: "Sequential array walk",
    note: "Reads 4-byte ints from 0x000 upward — strong spatial locality.",
    text: Array.from({ length: 32 }, (_, i) => `R 0x${(i * 4).toString(16).padStart(3, "0")}`).join(
      "\n",
    ),
  },
  strided: {
    label: "Column-major stride (128 B)",
    note: "Each access jumps 128 bytes — every access lands in a new block.",
    text: Array.from(
      { length: 24 },
      (_, i) => `R 0x${((i % 8) * 128 + Math.floor(i / 8) * 4).toString(16).padStart(3, "0")}`,
    ).join("\n"),
  },
  conflict: {
    label: "Conflict ping-pong",
    note: "Two addresses that map to the same set in a small direct-mapped cache.",
    text: [
      "R 0x000",
      "R 0x100",
      "R 0x000",
      "R 0x100",
      "R 0x004",
      "R 0x104",
      "R 0x000",
      "R 0x100",
      "W 0x008",
      "R 0x108",
    ].join("\n"),
  },
  loop: {
    label: "Loop reuse (temporal)",
    note: "A small working set re-read three times — temporal locality.",
    text: [0, 1, 2]
      .flatMap(() => ["R 0x040", "R 0x080", "R 0x0C0", "W 0x044", "R 0x200"])
      .join("\n"),
  },
};
