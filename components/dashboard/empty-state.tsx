import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Calm "nothing here yet" panel (v2): an icon in a soft round chip, one plain
 * title, one sentence of why/when, optionally an action. Used before the
 * first sync, when an integration isn't connected yet, and for empty
 * filters. `inset` = sits inside a card (muted panel); otherwise it is its
 * own top-level surface.
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
        "flex flex-col items-center justify-center px-6 py-10 text-center sm:py-12",
        inset ? "rounded-2xl bg-muted/60" : "surface",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mb-4 flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground",
          inset ? "bg-card shadow-card" : "bg-muted"
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-balance text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
