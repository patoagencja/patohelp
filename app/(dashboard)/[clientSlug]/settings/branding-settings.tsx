"use client";

import { useEffect, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BRAND_COLOR_PICKER_START,
  BRAND_COLOR_RE,
  LOGO_URL_MAX,
  clientAccentStyle,
  safeLogoUrl,
} from "@/lib/dashboard/branding";

import { saveClientBranding } from "./branding-actions";

/**
 * "Wygląd panelu" (agency only): the client's logo and accent colour, so the
 * panel, the PDF, the board link and the weekly e-mail look like the client's
 * own report. Rendered only inside the settings page, which already requires
 * requireAgencyClientAccess; the action re-checks it on every save.
 */
export function BrandingSettingsSection({
  clientSlug,
  clientName,
  available,
  initialLogoUrl,
  initialBrandColor,
}: {
  clientSlug: string;
  clientName: string;
  /** False before migration 0031 - the form would only fail on save. */
  available: boolean;
  initialLogoUrl: string | null;
  initialBrandColor: string | null;
}) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? "");
  const [color, setColor] = useState(initialBrandColor ?? "");
  const [pending, startTransition] = useTransition();

  // After a save the server re-renders with what was actually stored.
  useEffect(() => setLogoUrl(initialLogoUrl ?? ""), [initialLogoUrl]);
  useEffect(() => setColor(initialBrandColor ?? ""), [initialBrandColor]);

  const trimmedLogo = logoUrl.trim();
  const previewUrl = safeLogoUrl(trimmedLogo);
  const logoError =
    trimmedLogo && !previewUrl
      ? trimmedLogo.length > LOGO_URL_MAX
        ? `Link może mieć maksymalnie ${LOGO_URL_MAX} znaków.`
        : "Wklej pełny link zaczynający się od https://"
      : null;
  const trimmedColor = color.trim();
  const colorValid = BRAND_COLOR_RE.test(trimmedColor);
  const colorError = trimmedColor && !colorValid ? "Format #RRGGBB, np. #1E40AF." : null;
  const dirty =
    trimmedLogo !== (initialLogoUrl ?? "") ||
    trimmedColor.toLowerCase() !== (initialBrandColor ?? "");

  function save(next: { logoUrl: string; brandColor: string }, okMessage: string) {
    startTransition(async () => {
      const res = await saveClientBranding({ clientSlug, ...next });
      if (res.ok) toast.success(okMessage);
      else toast.error(res.error);
    });
  }

  return (
    <div id="wyglad" className="mt-8 scroll-mt-6">
      <h2 className="text-lg font-semibold">Wygląd panelu</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Logo i kolor klienta w panelu, w PDF-ie dla zarządu, w linku dla zarządu
        i w cotygodniowym e-mailu - żeby raport wyglądał jak jego własny. Kolor
        pojawia się tylko jako delikatny akcent.
      </p>

      <Card className="mt-4 max-w-3xl">
        <CardContent className="pt-6">
          {!available ? (
            <p className="text-sm text-muted-foreground">
              Uruchom w Supabase migrację{" "}
              <code className="rounded bg-muted px-1">0031_client_branding.sql</code>,
              żeby ustawić logo i kolor klienta.
            </p>
          ) : (
            <form
              className="flex flex-col gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (logoError || colorError) return;
                save({ logoUrl: trimmedLogo, brandColor: trimmedColor }, "Zapisano wygląd panelu");
              }}
            >
              {/* Logo */}
              <div className="flex flex-col gap-2">
                <label htmlFor="brand-logo-url" className="text-sm font-medium">
                  Link do logo
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="brand-logo-url"
                    type="url"
                    inputMode="url"
                    maxLength={LOGO_URL_MAX}
                    placeholder="https://www.example.pl/logo.png"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    aria-invalid={logoError ? true : undefined}
                    aria-describedby="brand-logo-hint"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={pending || !initialLogoUrl}
                    onClick={() =>
                      save(
                        { logoUrl: "", brandColor: initialBrandColor ?? "" },
                        "Przywrócono domyślne logo"
                      )
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Przywróć domyślne
                  </Button>
                </div>
                <p id="brand-logo-hint" className="text-xs text-muted-foreground">
                  {logoError ? (
                    <span className="text-destructive">{logoError}</span>
                  ) : (
                    <>
                      Wklej link do logo w PNG/SVG, najlepiej z przezroczystym tłem.
                      Do e-maila użyjemy tylko PNG/JPG - skrzynki pocztowe nie
                      pokazują SVG.
                    </>
                  )}
                </p>

                {/* Live preview on both backgrounds: the sidebar flips to dark
                    with the theme, the PDF is always white. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: "Jasne tło", box: "border-border bg-white text-slate-900" },
                    { label: "Ciemne tło", box: "border-slate-700 bg-slate-900 text-white" },
                  ].map((bg) => (
                    <div key={bg.label} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{bg.label}</span>
                      <div
                        className={`flex h-20 items-center justify-center rounded-lg border px-4 ${bg.box}`}
                      >
                        <ClientBrandMark
                          name={clientName}
                          slug={clientSlug}
                          logoUrl={previewUrl}
                          className="h-10 max-w-[12rem] [&:not(img)]:h-7"
                          fallback={
                            <span className="text-sm font-semibold">{clientName}</span>
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accent colour */}
              <div className="flex flex-col gap-2">
                <label htmlFor="brand-color-text" className="text-sm font-medium">
                  Kolor akcentu
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="color"
                    aria-label="Wybierz kolor akcentu"
                    value={colorValid ? trimmedColor.toLowerCase() : BRAND_COLOR_PICKER_START}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
                  />
                  <input
                    id="brand-color-text"
                    placeholder="brak (kolor panelu)"
                    maxLength={7}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    aria-invalid={colorError ? true : undefined}
                    className="h-9 w-40 rounded-md border border-input bg-background px-2 font-mono text-sm uppercase"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={pending || !initialBrandColor}
                    onClick={() =>
                      save(
                        { logoUrl: initialLogoUrl ?? "", brandColor: "" },
                        "Przywrócono domyślny kolor"
                      )
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Przywróć domyślny
                  </Button>
                </div>
                {colorError ? (
                  <p className="text-xs text-destructive">{colorError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Cienki pasek nad podsumowaniem i linia w nagłówku PDF. Reszta
                    panelu zostaje w naszych kolorach, żeby wykresy były czytelne.
                  </p>
                )}
                {/* Same token the dashboard uses, scoped to this preview. */}
                <div
                  style={clientAccentStyle(colorValid ? trimmedColor : null)}
                  className="relative max-w-sm overflow-hidden rounded-xl border border-border bg-card px-4 pb-3 pt-4 text-sm"
                >
                  <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-client-accent" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Podgląd akcentu
                  </p>
                  <p className="mt-1 font-medium">Najważniejsze w skrócie</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  size="sm"
                  className="w-fit"
                  disabled={pending || !dirty || Boolean(logoError || colorError)}
                >
                  {pending ? "Zapisuję…" : "Zapisz wygląd"}
                </Button>
                {dirty ? (
                  <span className="text-xs text-muted-foreground">Masz niezapisane zmiany.</span>
                ) : null}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
