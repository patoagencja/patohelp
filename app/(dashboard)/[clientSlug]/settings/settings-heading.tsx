import { cn } from "@/lib/utils";

/**
 * Section heading for the settings page in the 2026 pastel style: a mono
 * kicker ("Ustawienia · Integracje"), a 22px medium title and one plain
 * sentence. Local to settings so the shared SectionHeader keeps its look on
 * the other pages.
 */
export function SettingsHeading({
  title,
  description,
  kicker,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Mono eyebrow; defaults to "Ustawienia". */
  kicker?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 px-1", className)}>
      <div className="min-w-0 max-w-3xl">
        <p className="kick">{kicker ?? "Ustawienia"}</p>
        <h2 className="mt-2 text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
