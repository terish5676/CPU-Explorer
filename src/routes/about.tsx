import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RULES } from "@/lib/bottleneck";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Method — CPU Performance Explorer" },
      {
        name: "description",
        content: "What is simulated, what is measured, and how to read every number.",
      },
    ],
  }),
  component: About,
});

const SECTIONS: { h: string; body: string[] }[] = [
  {
    h: "Data telemetry & provenance",
    body: [
      "Every figure carries an authentic provenance stamp. Measured indicates real-time hardware execution telemetry captured directly from the runtime (JavaScript in a sandboxed Web Worker; C, C++, Python, and Java on Judge0 CE). Address Trace indicates exact mathematical calculations on physical address spaces. Microarchitecture Model indicates cycle-by-cycle microarchitectural simulation of pipelines and cache lines.",
      "Rule R4 compares real wall-clock elapsed time differences and cross-references them against static loop complexity and memory footprints.",
    ],
  },
  {
    h: "Cache model",
    body: [
      "Set-associative, write-allocate, block-addressed. Block = ⌊address ÷ block size⌋, set = block mod sets, tag = ⌊block ÷ sets⌋. Replacement is LRU, FIFO or seeded-random (mulberry32), so reruns are identical. A compulsory miss is the first-ever touch of a block. Reads and writes are treated the same for hit/miss; there is no write-back timing.",
    ],
  },
  {
    h: "Pipeline model",
    body: [
      "Classic five-stage in-order pipeline: IF, ID, EX, MEM, WB. Hazards modelled: RAW data hazards (with or without EX→EX / MEM→EX forwarding, including the load-use bubble), control hazards (fetch stalls after every branch until it resolves in EX — there is no branch prediction), and an optional single memory port that creates IF/MEM structural conflicts.",
      "It is a teaching model, not cycle-accurate for any real CPU. CPI = total cycles ÷ instructions completed.",
    ],
  },
  {
    h: "Memory locality",
    body: [
      "Spatial locality is the share of accesses landing within one block-size of the previous (non-identical) access. Temporal reuse is the share whose block appeared in the previous 16 accesses. The dominant stride and its share classify the pattern as sequential, strided or irregular.",
    ],
  },
  {
    h: "Code execution",
    body: [
      "JavaScript runs in a disposable Web Worker with no DOM, cookies or storage, killed after 5 seconds. C, C++, Python and Java are compiled and executed on Judge0 Community Edition — edit freely; there is no demo replay. Wall time is measured and stamped Measured. Stdin is forwarded for non-JS languages. Network access is required for those runners.",
    ],
  },
];

function About() {
  return (
    <div>
      <PageHeader
        index="09"
        title="Method &"
        italic="honesty"
        description="What the instrument does, what it doesn’t, and how every threshold is chosen."
      />
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-12">
          {SECTIONS.map((s, i) => (
            <section
              key={s.h}
              className="grid gap-4 border-t border-rule pt-5 md:grid-cols-[4rem_1fr]"
            >
              <span className="numeral text-5xl text-signal">{i + 1}</span>
              <div>
                <h2 className="text-4xl">{s.h}</h2>
                {s.body.map((p) => (
                  <p key={p} className="mt-3 max-w-2xl leading-relaxed text-ink-2">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="panel panel-tick h-fit p-5">
          <h2 className="text-3xl">Rule thresholds</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {RULES.map((r) => (
              <li key={r.id} className="flex gap-3">
                <span className="font-mono text-xs text-signal">{r.id}</span>
                <span className="text-ink-2">{r.description}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
