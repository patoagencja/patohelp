import type { ReactNode } from "react";

// The Sprzedaż tab reads top to bottom as a story a shop owner can retell to
// the board: where we are -> is it profitable -> what sells -> where buyers
// come from -> the season ahead. Numbered headings make that order explicit.
export function StorySection({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const id = `sekcja-${step}`;
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary dark:text-indigo-300"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-balance text-lg font-semibold leading-tight">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}
