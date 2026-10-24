import type { DataSource } from "./execution-adapter";

/** Pick a badge stamp that reflects a set of saved runs honestly. */
export function provenanceOf(
  sources: Iterable<DataSource | undefined>,
): DataSource {
  const set = new Set<DataSource>();
  for (const s of sources) if (s) set.add(s);
  if (set.size === 0) return "Simulated";
  if (set.size === 1) return [...set][0]!;
  // Mixed stores: prefer the strongest claim present.
  if (set.has("Measured")) return "Measured";
  if (set.has("User trace")) return "User trace";
  return "Simulated";
}
