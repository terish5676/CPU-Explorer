import { Link, useLocation } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRuns } from "@/lib/runs-store";

export const NAV = [
  { to: "/", label: "Index", exact: true },
  { to: "/code-lab", label: "Code Lab" },
  { to: "/cache", label: "Cache" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/memory", label: "Memory" },
  { to: "/assembly", label: "Assembly" },
  { to: "/monitor", label: "Monitor" },
  { to: "/analysis", label: "Analysis" },
  { to: "/runs", label: "Runs" },
  { to: "/about", label: "Method" },
] as const;

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "light" | "dark") ?? "light");
  }, []);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("cpu-explorer.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return (
    <button
      onClick={flip}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      className="flex h-8 items-center gap-2 border border-rule px-2 font-mono text-[11px] uppercase tracking-wider hover:bg-ink hover:text-paper"
    >
      {theme === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      {theme === "light" ? "Phosphor" : "Paper"}
    </button>
  );
}

/** A real counter: it advances with wall-clock time like a free-running cycle register. */
function CycleCounter() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => setN(Math.floor((performance.now() - t0) / 10)), 50);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="hidden font-mono text-[11px] tabular-nums text-ink-3 md:inline" aria-hidden>
      CYC <span className="text-ink">0x{n.toString(16).toUpperCase().padStart(6, "0")}</span>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const runs = useRuns();
  const active = (n: (typeof NAV)[number]) =>
    "exact" in n ? pathname === n.to : pathname.startsWith(n.to);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-2.5">
          <Link to="/" className="group flex items-baseline gap-2.5">
            <span className="relative flex h-7 w-7 items-center justify-center border border-ink">
              <span className="h-2.5 w-2.5 bg-signal transition-transform group-hover:rotate-90" />
              <span className="absolute -top-1 left-2 h-1 w-px bg-ink" />
              <span className="absolute -bottom-1 left-2 h-1 w-px bg-ink" />
              <span className="absolute -left-1 top-2 h-px w-1 bg-ink" />
              <span className="absolute -right-1 top-2 h-px w-1 bg-ink" />
            </span>
            <span className="font-display text-2xl leading-none">
              CPU<span className="italic text-ink-3">/</span>Explorer
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <CycleCounter />
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Primary" className="border-t border-rule-soft">
          <ul className="mx-auto flex max-w-[1400px] overflow-x-auto px-5">
            {NAV.map((n, i) => (
              <li key={n.to} className="shrink-0">
                <Link
                  to={n.to}
                  className={cn(
                    "group relative flex items-baseline gap-1.5 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors first:pl-0",
                    active(n) ? "text-ink" : "text-ink-3 hover:text-ink",
                  )}
                >
                  <span className={cn("tabular-nums", active(n) ? "text-signal" : "opacity-60")}>
                    {String(i).padStart(2, "0")}
                  </span>
                  {n.label}
                  {n.to === "/runs" && runs.length > 0 && (
                    <sup className="ml-0.5 bg-ink px-1 text-[9px] text-paper">{runs.length}</sup>
                  )}
                  <span
                    className={cn(
                      "absolute inset-x-3 -bottom-px h-[3px] bg-signal transition-transform origin-left first:inset-x-0",
                      active(n)
                        ? "scale-x-100"
                        : "scale-x-0 group-hover:scale-x-100 group-hover:bg-ink",
                    )}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 pb-24">{children}</main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-5 py-4 font-mono text-[11px] uppercase tracking-wider text-ink-3">
          <span>Measured code runs · teaching cache/pipeline models · no hardware PMCs</span>
          <span>Deterministic simulators · same input → same output</span>
        </div>
      </footer>
    </div>
  );
}
