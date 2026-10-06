import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Every page opens the same way so a first-time visitor knows where they
 * are: a title, one plain sentence saying what question the page answers,
 * and (optionally) the page's controls on the right - usually the date
 * range picker. Kept outside the presentation slides' internals: render it
 * as the first child of the page container.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  /** One sentence, plain Polish: what this page answers. */
  description?: React.ReactNode;
  /** Right-aligned controls (date range, PDF). Wraps under on phones. */
  actions?: React.ReactNode;
  /** Small muted line above the title (e.g. the period). Normal case. */
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="text-[1.625rem] font-semibold leading-tight tracking-[-0.022em] text-foreground md:text-page-title">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2" data-print-hide>
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** Section heading inside a page: title + optional one-line explanation. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
  as: Tag = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <Tag className="text-section-title text-foreground">{title}</Tag>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
