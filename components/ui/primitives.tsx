import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Small 2026 pastel building blocks (see bench/d26-system.md). Server-safe.
 */

/** Mono uppercase eyebrow: "PLAN MIESIĄCA", "OSTATNIE 30 DNI". */
export function Kick({
  as: Tag = "span",
  className,
  ...props
}: { as?: "span" | "p" | "div" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("kick", className)} {...props} />;
}

export type PingTone = "live" | "lime" | "coral" | "amber" | "muted";

const PING_TONE: Record<PingTone, string> = {
  live: "",
  lime: "ping-lime",
  coral: "ping-coral",
  amber: "ping-amber",
  muted: "ping-muted ping-still",
};

/** Status dot with a soft ping ring (decorative - pair it with words). */
export function Ping({
  tone = "live",
  still = false,
  className,
}: {
  tone?: PingTone;
  /** No ring animation (e.g. "off" rows, long lists). */
  still?: boolean;
  className?: string;
}) {
  return <span aria-hidden className={cn("ping", PING_TONE[tone], still && "ping-still", className)} />;
}

/** Chip-coloured pill with a ping dot: "2 rzeczy do sprawdzenia". */
export function StatusChip({
  tone = "live",
  className,
  children,
  ...props
}: { tone?: PingTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex min-h-[38px] items-center gap-2.5 rounded-full bg-chip py-1 pl-3.5 pr-4 text-sm font-medium text-foreground",
        className
      )}
      {...props}
    >
      <Ping tone={tone} />
      {children}
    </span>
  );
}

/** Coral count badge for a 44px icon button (bell). */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-coral px-[5px] text-[11px] font-bold leading-none text-coral-foreground tabular-nums",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** Class recipe: the 44px round chip icon button (`.ib`). */
export const iconButton =
  "relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-chip text-foreground transition-[transform,background-color] duration-200 hover:bg-[var(--chip-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100 [&_svg]:h-[18px] [&_svg]:w-[18px]";
