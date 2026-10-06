import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Calm "nothing here yet" panel (Stany board, 2026 pastel): an icon in a
 * soft rounded tile, one plain title, one sentence of why/when, optionally
 * an action. Used before the first sync, when an integration isn't
 * connected yet, and for empty filters/periods. `inset` = sits inside a
 * card (chip panel); otherwise it is its own glass card.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  inset = false,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** A link or button, e.g. "Podłącz Google Analytics". */
  action?: React.ReactNode;
  inset?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 text-center",
        inset ? "rounded-[22px] bg-chip py-9 sm:py-10" : "glass rounded-card py-11 sm:px-7 sm:py-12",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mb-1 grid h-[52px] w-[52px] place-items-center rounded-[16px] text-ink-2",
          inset ? "bg-card/80 shadow-card dark:bg-chip" : "bg-chip"
        )}
      >
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
      </span>
      <p className="text-lg font-medium tracking-[-0.02em] text-foreground">{title}</p>
      {description ? (
        <p className="max-w-[24rem] text-balance text-sm leading-relaxed text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
