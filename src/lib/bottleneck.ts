// Transparent, deterministic rule engine comparing two runs.
import type { SavedRun } from "./runs-store";

export interface Finding {
  rule: string;
  title: string;
  detail: string;
  evidence: "Observed" | "Simulated";
  severity: "high" | "medium" | "low" | "info";
  confidence: "High" | "Medium" | "Low";
  nextSteps: string[];
}

export interface RuleDef {
  id: string;
  description: string;
}

export const RULES: RuleDef[] = [
  {
    id: "R1",
    description: "Miss ratio rises by ≥ 5 percentage points → memory hierarchy bottleneck.",
  },
  {
    id: "R2",
    description:
      "Stall cycles increase by ≥ 20% (or ≥ 2 cycles) → pipeline hazard bottleneck; attributes to data/control/structural.",
  },
  { id: "R3", description: "CPI increases by ≥ 10% → lower instruction throughput." },
  {
    id: "R4",
    description:
      "Elapsed time differs by ≥ 10% → reported as Observed ONLY if both runs are Measured; otherwise flagged as modeled.",
  },
  {
    id: "R5",
    description: "Spatial locality drops by ≥ 15 percentage points → access-pattern issue.",
  },
  { id: "R6", description: "Runs of different kinds or sources → comparison limitations noted." },
];

const ev = (a: SavedRun, b: SavedRun): Finding["evidence"] =>
  a.source === "Measured" && b.source === "Measured" ? "Observed" : "Simulated";

export function compareRuns(a: SavedRun, b: SavedRun): Finding[] {
  const f: Finding[] = [];
  const m = (k: string) => [a.metrics[k] ?? 0, b.metrics[k] ?? 0] as const;
  const has = (k: string) => typeof a.metrics[k] === "number" && typeof b.metrics[k] === "number";

  if (a.kind !== b.kind || a.source !== b.source) {
    f.push({
      rule: "R6",
      title: "Comparison has limitations",
      severity: "info",
      confidence: "Low",
      evidence: ev(a, b),
      detail: `Run A is a ${a.kind} run (${a.source}); Run B is a ${b.kind} run (${b.source}). Only metrics present in both are compared.`,
      nextSteps: ["Compare runs of the same kind and data source for stronger conclusions."],
    });
  }

  const missKey = has("missRatio") ? "missRatio" : has("cacheMissRatio") ? "cacheMissRatio" : null;
  if (missKey) {
    const [x, y] = m(missKey);
    const d = y - x;
    if (Math.abs(d) >= 0.05) {
      const worse = d > 0 ? b : a;
      f.push({
        rule: "R1",
        title: `Memory hierarchy: miss ratio ${d > 0 ? "rose" : "fell"} ${(Math.abs(d) * 100).toFixed(1)} pp`,
        detail: `Miss ratio ${(x * 100).toFixed(1)}% → ${(y * 100).toFixed(1)}%. "${worse.name}" incurs more misses, so more accesses pay the lower-level memory penalty.`,
        severity: Math.abs(d) >= 0.2 ? "high" : "medium",
        confidence: "High",
        evidence: ev(a, b),
        nextSteps: [
          "Reorder loops so the innermost loop walks contiguous memory.",
          "Try a larger block size (spatial) or higher associativity (conflicts) in the Cache Simulator.",
          "Use blocking/tiling to keep the working set within cache capacity.",
        ],
      });
    }
  }

  if (has("stalls")) {
    const [x, y] = m("stalls");
    const d = y - x;
    if (Math.abs(d) >= 2 && Math.abs(d) >= 0.2 * Math.max(1, x)) {
      const worse = d > 0 ? b : a;
      const parts = (["dataStalls", "controlStalls", "structuralStalls"] as const)
        .map((k) => ({ k, d: (b.metrics[k] ?? 0) - (a.metrics[k] ?? 0) }))
        .filter((p) => p.d !== 0)
        .map((p) => `${p.k.replace("Stalls", "")} ${p.d > 0 ? "+" : ""}${p.d}`);
      f.push({
        rule: "R2",
        title: `Pipeline hazards: ${Math.abs(d)} ${d > 0 ? "more" : "fewer"} stall cycles`,
        detail: `Stalls ${x} → ${y} (${parts.join(", ") || "no breakdown"}). "${worse.name}" spends more cycles waiting.`,
        severity: Math.abs(d) >= 5 ? "high" : "medium",
        confidence: "High",
        evidence: "Simulated",
        nextSteps: [
          "Enable forwarding to remove most ALU→ALU RAW stalls.",
          "Schedule an independent instruction between a load and its use.",
          "Reduce taken branches in tight loops (e.g. loop unrolling) to cut control stalls.",
        ],
      });
    }
  }

  if (has("cpi")) {
    const [x, y] = m("cpi");
    if (x > 0 && Math.abs(y - x) / x >= 0.1) {
      f.push({
        rule: "R3",
        title: `Throughput: CPI ${y > x ? "increased" : "decreased"} ${(((y - x) / x) * 100).toFixed(0)}%`,
        detail: `CPI ${x.toFixed(2)} → ${y.toFixed(2)} (CPI = total cycles ÷ instructions completed).`,
        severity: "medium",
        confidence: "High",
        evidence: "Simulated",
        nextSteps: ["Inspect the pipeline grid for the instructions with the longest ID/EX waits."],
      });
    }
  }

  if (has("executionTimeMs")) {
    const [x, y] = m("executionTimeMs");
    if (x > 0 && Math.abs(y - x) / x >= 0.1) {
      const obs = ev(a, b) === "Observed";
      f.push({
        rule: "R4",
        title: `Elapsed time ${y > x ? "longer" : "shorter"} by ${((Math.abs(y - x) / x) * 100).toFixed(0)}%`,
        detail: obs
          ? `Measured ${x.toFixed(2)} ms → ${y.toFixed(2)} ms. Repeat runs to rule out noise.`
          : `Reported ${x.toFixed(2)} ms → ${y.toFixed(2)} ms, but at least one run is not Measured — treat the delta as provisional.`,
        severity: obs ? "medium" : "info",
        confidence: obs ? "Medium" : "Low",
        evidence: obs ? "Observed" : "Simulated",
        nextSteps: obs
          ? ["Run each version ≥ 5 times and compare medians."]
          : ["Re-run both programs in the Code Lab so both timings are Measured."],
      });
    }
  }

  if (has("spatialLocality")) {
    const [x, y] = m("spatialLocality");
    if (Math.abs(y - x) >= 0.15) {
      f.push({
        rule: "R5",
        title: `Access pattern: spatial locality ${y < x ? "dropped" : "improved"} ${(Math.abs(y - x) * 100).toFixed(0)} pp`,
        detail: `Share of accesses within one block of the previous access: ${(x * 100).toFixed(0)}% → ${(y * 100).toFixed(0)}%.`,
        severity: "medium",
        confidence: "Medium",
        evidence:
          a.source === "User trace" || b.source === "User trace" ? "Simulated" : "Simulated",
        nextSteps: [
          "Prefer unit-stride traversal; restructure data as struct-of-arrays where appropriate.",
        ],
      });
    }
  }

  if (!f.filter((x) => x.rule !== "R6").length) {
    f.push({
      rule: "—",
      title: "No significant difference detected",
      severity: "low",
      confidence: "Medium",
      evidence: ev(a, b),
      detail: "No rule threshold was crossed by the shared metrics.",
      nextSteps: [
        "Try configurations that differ more (e.g. direct-mapped vs 4-way, forwarding on vs off).",
      ],
    });
  }
  return f;
}
