import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    className="toaster group"
    toastOptions={{
      unstyled: true,
      classNames: {
        toast:
          "flex w-[22rem] items-start gap-3 border border-ink bg-paper px-4 py-3 font-mono text-xs shadow-[4px_4px_0_var(--ink)]",
        title: "font-medium uppercase tracking-wider",
        description: "text-ink-3",
        success: "[&_[data-icon]]:text-hit border-l-[6px] border-l-signal",
        error: "border-l-[6px] border-l-miss",
      },
    }}
    {...props}
  />
);

export { Toaster };
