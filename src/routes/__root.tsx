import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-6xl flex-col justify-center px-6">
      <p className="label-mono">Error 404 · address not mapped</p>
      <h1 className="numeral mt-3 text-[clamp(7rem,26vw,20rem)]">
        4<span className="text-signal">0</span>4
      </h1>
      <p className="max-w-md text-ink-2">
        That address isn’t in any set of this cache. Nothing was fetched, nothing was evicted.
      </p>
      <div className="mt-6">
        <Link to="/" className="btn">
          Return to index
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center px-6">
      <p className="label-mono text-signal">Fault · unhandled exception</p>
      <h1 className="mt-3 text-6xl">The pipeline flushed.</h1>
      <p className="mt-3 max-w-md text-ink-2">
        Something threw while rendering this page. Retry, or head back to the index.
      </p>
      <pre className="mt-4 max-h-32 overflow-auto border border-rule p-3 font-mono text-xs text-ink-2">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <div className="mt-6 flex gap-2">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="btn"
        >
          Retry
        </button>
        <a href="/" className="btn btn-ghost">
          Index
        </a>
      </div>
    </div>
  );
}

const THEME_BOOT = `try{var t=localStorage.getItem("cpu-explorer.theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CPU Performance Explorer" },
      {
        name: "description",
        content:
          "Cache, pipeline and memory-locality simulators with a transparent, rule-based bottleneck analyser.",
      },
      { property: "og:title", content: "CPU Performance Explorer" },
      {
        property: "og:description",
        content: "Cache and pipeline simulators with transparent bottleneck analysis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Instrument+Serif:ital@0;1&display=swap",
      },
    ],
    scripts: [{ children: THEME_BOOT }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
