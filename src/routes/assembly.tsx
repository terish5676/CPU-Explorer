import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Save, Send } from "lucide-react";
import { CATEGORIES, countCategories, parseAsm, type InstrCategory } from "@/lib/asm-parser";
import { EXAMPLES } from "@/lib/examples";
import { runsStore } from "@/lib/runs-store";
import { sendHandoff, takeHandoff } from "@/lib/handoff";
import { DataBadge, Kpi, PageHeader, Sheet } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly")({
  head: () => ({
    meta: [
      { title: "Assembly Explorer — CPU Performance Explorer" },
      {
        name: "description",
        content: "Classify assembly instructions into arithmetic, memory, control and logic.",
      },
    ],
  }),
  component: Assembly,
});

const withAsm = EXAMPLES.filter((e) => e.asm);
const CAT_BG: Record<InstrCategory, string> = {
  arithmetic: "bg-stage-if",
  "load/store": "bg-stage-mem",
  control: "bg-signal text-signal-ink",
  logic: "bg-stage-id",
  other: "bg-paper-2",
};

function Assembly() {
  const navigate = useNavigate();
  const [text, setText] = useState(withAsm[0]!.asm!);
  const [title, setTitle] = useState(withAsm[0]!.title);
  const [filter, setFilter] = useState<InstrCategory | null>(null);

  useEffect(() => {
    const h = takeHandoff();
    if (h && h.kind === "asm") {
      setText(h.text);
      setTitle(h.label);
      toast.success("Assembly received", { description: h.label });
    }
  }, []);

  const lines = useMemo(() => parseAsm(text), [text]);
  const counts = useMemo(() => countCategories(lines), [lines]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const mnemonics = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach((l) => l.mnemonic && m.set(l.mnemonic, (m.get(l.mnemonic) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [lines]);
  const memShare = total ? counts["load/store"] / total : 0;
  const arithShare = total ? counts.arithmetic / total : 0;
  const ctrlShare = total ? counts.control / total : 0;
  const logicShare = total ? counts.logic / total : 0;

  const saveRun = () => {
    if (total === 0) {
      toast.error("No instructions to analyze");
      return;
    }
    runsStore.add({
      name: `Assembly · ${title}`,
      kind: "code",
      source: "User trace",
      inputs: { title, instructions: total },
      metrics: {
        instructions: total,
        loadStoreShare: memShare,
        arithmeticCount: counts.arithmetic,
        loadStoreCount: counts["load/store"],
        controlCount: counts.control,
        logicCount: counts.logic,
      },
    });
    toast.success("Assembly analysis saved", { description: "Available in Monitor & Analysis." });
  };

  const toPipeline = () => {
    // Convert common x86/RISC instructions into RISC-V compatible instructions for the pipeline
    const pipelineCompatible = lines
      .filter((l) => l.mnemonic)
      .slice(0, 30)
      .map((l, i) => {
        const m = l.mnemonic?.toLowerCase() ?? "";
        if (m.startsWith("mov") || m.startsWith("lw") || m.startsWith("ld")) {
          return `lw x${(i % 6) + 1}, ${(i * 4) % 64}(x2)`;
        }
        if (m.startsWith("st") || m.startsWith("sw") || m.startsWith("push")) {
          return `sw x${(i % 6) + 1}, ${(i * 4) % 64}(x2)`;
        }
        if (m.startsWith("add")) {
          return `add x${(i % 6) + 1}, x${((i + 1) % 6) + 1}, x${((i + 2) % 6) + 1}`;
        }
        if (m.startsWith("sub")) {
          return `sub x${(i % 6) + 1}, x${((i + 1) % 6) + 1}, x${((i + 2) % 6) + 1}`;
        }
        if (m.startsWith("and")) {
          return `and x${(i % 6) + 1}, x${((i + 1) % 6) + 1}, x${((i + 2) % 6) + 1}`;
        }
        if (m.startsWith("or")) {
          return `or x${(i % 6) + 1}, x${((i + 1) % 6) + 1}, x${((i + 2) % 6) + 1}`;
        }
        if (m.startsWith("j") || m.startsWith("b")) {
          return `beq x1, x2, 4`;
        }
        return `addi x${(i % 6) + 1}, x0, ${i + 1}`;
      })
      .join("\n");

    sendHandoff({
      kind: "program",
      text: pipelineCompatible || "addi x1, x0, 5\naddi x2, x0, 10\nadd x3, x1, x2",
      label: `Pipeline mapped from ${title}`,
    });
    navigate({ to: "/pipeline" });
  };

  return (
    <div>
      <PageHeader
        index="05"
        title="Assembly"
        italic="explorer"
        description="Inspect instruction mixes, memory access density, and control flow complexity across real compiler output. A high load/store share indicates memory-bound performance; high control flow stresses processor branch prediction."
      >
        <DataBadge source="User trace" />
      </PageHeader>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Sheet
          title="Listing"
          tag="A"
          actions={
            <div className="flex items-center gap-2">
              <span className="label-mono">{total} instructions</span>
              <button className="btn btn-ghost btn-sm" onClick={saveRun} type="button">
                <Save className="h-3.5 w-3.5" /> Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={toPipeline} type="button">
                <Send className="h-3.5 w-3.5" /> Send to Pipeline <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {withAsm.map((e) => (
              <button
                key={e.id}
                className={cn("btn btn-sm", title !== e.title && "btn-ghost")}
                onClick={() => {
                  setText(e.asm!);
                  setTitle(e.title);
                }}
              >
                {e.title}
              </button>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <textarea
              className="editor h-96"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTitle("custom");
              }}
              spellCheck={false}
              aria-label="Assembly listing"
            />
            <div className="h-96 overflow-auto border border-rule font-mono text-xs">
              {lines.map((l) => (
                <div
                  key={l.n}
                  className={cn(
                    "grid grid-cols-[2rem_1fr_5.5rem] items-center gap-2 px-2 py-0.5",
                    filter && l.category !== filter && "opacity-20",
                  )}
                >
                  <span className="text-ink-3">{l.n}</span>
                  <span className="truncate">{l.raw || " "}</span>
                  {l.category ? (
                    <span
                      className={cn("px-1 text-center text-[10px] uppercase", CAT_BG[l.category])}
                    >
                      {l.category}
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </div>
        </Sheet>
        <div className="flex flex-col gap-6">
          <Kpi
            accent
            label="Load / store share"
            value={`${(memShare * 100).toFixed(0)}%`}
            sub={memShare > 0.35 ? "memory-heavy (cache sensitive)" : "compute-leaning (ALU bound)"}
          />
          <Sheet title="Instruction mix" tag="B">
            <div className="flex h-8 border border-ink">
              {CATEGORIES.map(
                (c) =>
                  counts[c] > 0 && (
                    <div
                      key={c}
                      className={cn("h-full border-r border-ink last:border-0", CAT_BG[c])}
                      style={{ width: `${(counts[c] / Math.max(1, total)) * 100}%` }}
                      title={`${c}: ${counts[c]}`}
                    />
                  ),
              )}
            </div>
            <ul className="mt-4 font-mono text-xs">
              {CATEGORIES.map((c) => (
                <li key={c}>
                  <button
                    onClick={() => setFilter(filter === c ? null : c)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-rule-soft py-1.5 text-left hover:bg-paper-2",
                      filter === c && "bg-paper-2",
                    )}
                  >
                    <i className={cn("inline-block h-3 w-3 border border-rule-soft", CAT_BG[c])} />
                    <span className="flex-1 capitalize">{c}</span>
                    <span>{counts[c]}</span>
                    <span className="w-10 text-right text-ink-3">
                      {total ? ((counts[c] / total) * 100).toFixed(0) : 0}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-3">Click a row to isolate and highlight lines.</p>
          </Sheet>
          <Sheet title="Top mnemonics" tag="C">
            <ul className="space-y-1.5 font-mono text-xs">
              {mnemonics.map(([m, n]) => (
                <li key={m} className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2">
                  <span className="font-bold">{m}</span>
                  <span className="h-3 border border-rule">
                    <span
                      className="block h-full bg-ink"
                      style={{ width: `${(n / (mnemonics[0]?.[1] || 1)) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-ink-3">{n}</span>
                </li>
              ))}
            </ul>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
