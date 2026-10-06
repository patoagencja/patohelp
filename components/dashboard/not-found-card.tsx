import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Nie ma takiej strony" in the v2 skin: one calm card with an icon chip,
 * plain words and the anchor pill back to safety. Shared by the global
 * not-found page and the one inside the client dashboard shell.
 */
export function NotFoundCard({
  href,
  linkLabel,
  description = "Ten adres nie prowadzi do żadnej strony panelu. Link mógł wygasnąć albo zawierać literówkę.",
  className,
}: {
  href: string;
  linkLabel: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("surface w-full max-w-md p-7 text-center sm:p-8", className)}>
      <span
        aria-hidden
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Compass className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-medium tabular-nums text-muted-foreground">Błąd 404</p>
      <h1 className="mt-1 text-section-title">Nie znaleźliśmy tej strony</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <Link href={href} className={cn(buttonVariants(), "mt-6")}>
        <ArrowLeft aria-hidden />
        {linkLabel}
      </Link>
    </div>
  );
}
