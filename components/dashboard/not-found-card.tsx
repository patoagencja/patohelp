import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Nie ma takiej strony" in the 2026 pastel skin: one frosted card with a
 * mono kicker, the big light "404" in the hero ink gradient, plain words
 * and the ink pill back to safety. Shared by the global not-found page and
 * the one inside the client dashboard shell.
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
    <div
      className={cn(
        "glass glass-blur flex w-full max-w-[28rem] flex-col items-start gap-5 rounded-glass p-7 animate-rise sm:p-10",
        className
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <p className="kick">Błąd 404</p>
        <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-chip text-ink-2">
          <Compass className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p
        aria-hidden
        className="num-grad -my-1 text-[5.5rem] font-light leading-[0.9] tracking-[-0.06em] tabular-nums sm:text-[6.5rem]"
      >
        404
      </p>
      <div>
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em]">Nie znaleźliśmy tej strony</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2 [text-wrap:pretty]">{description}</p>
      </div>
      <Link href={href} className={cn(buttonVariants({ size: "pill" }), "mt-1")}>
        <ArrowLeft aria-hidden />
        {linkLabel}
      </Link>
    </div>
  );
}
