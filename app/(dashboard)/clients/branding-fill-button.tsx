"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { fillMissingBranding, type BrandingFillResult } from "./branding-fill-actions";

/**
 * "Uzupełnij brandingi" on the agency client picker. The summary is shown
 * inline (this page has no toaster) and every client that still needs a
 * human links straight to its branding settings.
 */
export function BrandingFillButton({ className }: { className?: string }) {
  const [result, setResult] = useState<BrandingFillResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        setResult(await fillMissingBranding());
      } catch {
        setResult({ ok: false, error: "Nie udało się uruchomić. Spróbuj ponownie." });
      }
    });
  }

  const toCheck = result?.ok ? result.items.filter((i) => i.status !== "filled") : [];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-xl" disabled={pending} onClick={run}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Palette className="h-3.5 w-3.5" aria-hidden />}
          {pending ? "Pobieram ze stron klientów…" : "Uzupełnij brandingi"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Logo i kolor ze stron klientów, którzy mają wpisaną stronę, a nie mają brandingu. Zapisujemy tylko pewne wyniki.
        </span>
      </div>

      {result ? (
        <div role="status" className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm shadow-sm">
          {!result.ok ? (
            <p className="text-destructive">{result.error}</p>
          ) : result.attempted === 0 && result.remaining === 0 ? (
            <p className="text-muted-foreground">
              Brak klientów do uzupełnienia - wpisz stronę klienta w Ustawieniach → Wygląd panelu.
            </p>
          ) : (
            <>
              <p className="font-medium">
                Uzupełniono {result.completed} z {result.attempted}
                {toCheck.length > 0 ? ` - ${toCheck.length} do ręcznego sprawdzenia` : ""}
                {result.remaining > 0 ? `. Pozostało ${result.remaining} - kliknij ponownie.` : ""}
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {result.items.map((item) => (
                  <li key={item.slug} className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-start gap-1.5">
                      {item.status === "filled" ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium">{item.name}</span>
                        {item.filled.length > 0 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            - zapisano {item.filled.map((f) => (f === "logo" ? "logo" : "kolor")).join(" i ")}
                          </span>
                        ) : null}
                        {item.reason ? <span className="block text-muted-foreground">{item.reason}</span> : null}
                      </span>
                    </span>
                    {item.status !== "filled" ? (
                      <Link
                        href={`/${item.slug}/settings#wyglad`}
                        className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium hover:bg-muted/70"
                      >
                        Sprawdź
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
