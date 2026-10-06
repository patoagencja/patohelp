"use client";

import { useEffect, useState, useTransition } from "react";
import { Globe, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Confidence, LogoKind } from "@/lib/branding/parse";
import { URL_PROBLEM_MESSAGE, WEBSITE_URL_MAX, parseWebsiteUrl } from "@/lib/branding/website";
import { clientAccentStyle } from "@/lib/dashboard/branding";
import { cn } from "@/lib/utils";

import { fetchBrandingPreview, saveClientBranding, type BrandingPreview } from "./branding-actions";

const KEEP = "__keep__";

const KIND_LABEL: Record<LogoKind, string> = {
  logo: "Logo",
  icon: "Ikona",
  og: "Grafika og:image",
  favicon: "Favicon",
};

const CONFIDENCE: Record<Confidence, { label: string; className: string }> = {
  high: { label: "pewne", className: "bg-positive-soft text-positive" },
  medium: { label: "prawdopodobne", className: "bg-muted text-muted-foreground" },
  low: { label: "do sprawdzenia", className: "bg-warning-soft text-warning" },
};

/**
 * "Pobierz ze strony": the client's website address + a preview of the logo
 * and colour found there. Nothing is applied until "Zapisz" - a guessed logo
 * must never silently replace one the agency picked by hand.
 */
export function BrandingWebsiteFetch({
  clientSlug,
  currentLogoUrl,
  currentBrandColor,
  websiteAvailable,
  initialWebsiteUrl,
  websiteSuggestion,
}: {
  clientSlug: string;
  currentLogoUrl: string | null;
  currentBrandColor: string | null;
  /** False before migration 0032: fetching works, the address isn't kept. */
  websiteAvailable: boolean;
  initialWebsiteUrl: string | null;
  /** From the GA4 property name, shown only while the field is empty. */
  websiteSuggestion: string | null;
}) {
  const [website, setWebsite] = useState(initialWebsiteUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BrandingPreview | null>(null);
  const [logoChoice, setLogoChoice] = useState(KEEP);
  const [colorChoice, setColorChoice] = useState(KEEP);
  const [brokenImages, setBrokenImages] = useState<string[]>([]);
  const [fetching, startFetch] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => setWebsite(initialWebsiteUrl ?? ""), [initialWebsiteUrl]);

  const trimmed = website.trim();
  const parsed = trimmed ? parseWebsiteUrl(trimmed) : null;
  const inputError = parsed && !parsed.ok ? URL_PROBLEM_MESSAGE[parsed.problem] : null;

  function runFetch() {
    if (!parsed?.ok) return;
    setError(null);
    startFetch(async () => {
      const res = await fetchBrandingPreview({ clientSlug, websiteUrl: trimmed });
      if (!res.ok) {
        setPreview(null);
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setPreview(res.preview);
      setBrokenImages([]);
      setLogoChoice(res.preview.logoCandidates[0]?.url ?? KEEP);
      setColorChoice(res.preview.colorCandidates[0]?.color ?? KEEP);
    });
  }

  function apply() {
    startSave(async () => {
      const res = await saveClientBranding({
        clientSlug,
        logoUrl: logoChoice === KEEP ? currentLogoUrl ?? "" : logoChoice,
        brandColor: colorChoice === KEEP ? currentBrandColor ?? "" : colorChoice,
      });
      if (res.ok) {
        toast.success("Zapisano logo i kolor ze strony klienta");
        setPreview(null);
      } else toast.error(res.error);
    });
  }

  const nothingChosen =
    (logoChoice === KEEP || logoChoice === currentLogoUrl) &&
    (colorChoice === KEEP || colorChoice === currentBrandColor);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="brand-website-url" className="text-sm font-medium">
          Strona klienta
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="brand-website-url"
            type="url"
            inputMode="url"
            maxLength={WEBSITE_URL_MAX}
            placeholder="https://www.firma.pl"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onKeyDown={(e) => {
              // Enter here must fetch, not submit the surrounding settings form.
              if (e.key === "Enter") {
                e.preventDefault();
                runFetch();
              }
            }}
            aria-invalid={inputError ? true : undefined}
            aria-describedby="brand-website-hint"
            className="h-9 min-w-0 flex-1 rounded-xl border border-transparent bg-muted transition-shadow hover:bg-secondary focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted px-3 text-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1.5"
            disabled={fetching || !parsed?.ok}
            onClick={runFetch}
          >
            {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Globe className="h-3.5 w-3.5" aria-hidden />}
            {fetching ? "Pobieram…" : "Pobierz ze strony"}
          </Button>
        </div>
        <p id="brand-website-hint" className="text-xs text-muted-foreground">
          {inputError ? (
            <span className="text-destructive">{inputError}</span>
          ) : (
            <>
              Znajdziemy logo i kolor marki na stronie głównej - zanim cokolwiek
              zapiszesz, pokażemy podgląd.
              {!websiteAvailable ? (
                <>
                  {" "}
                  Uruchom migrację{" "}
                  <code className="rounded bg-muted px-1">0032_client_website.sql</code>, żeby
                  zapamiętać adres.
                </>
              ) : null}
            </>
          )}
        </p>
        {!trimmed && websiteSuggestion ? (
          <p className="text-xs text-muted-foreground">
            Podpowiedź z GA4:{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setWebsite(websiteSuggestion)}
            >
              {websiteSuggestion.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </button>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {preview ? (
        <div className="flex flex-col gap-4 border-t border-border pt-3" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            Znalezione na{" "}
            <span className="font-medium text-foreground">
              {preview.siteName ? `${preview.siteName} · ` : ""}
              {new URL(preview.finalUrl).hostname}
            </span>
          </p>

          {/* Logo options */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Logo</legend>
            {preview.logoCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nie znaleziono logo - wklej link ręcznie.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {preview.logoCandidates.map((c) => {
                  const broken = brokenImages.includes(c.url);
                  return (
                    <label
                      key={c.url}
                      className={cn(
                        "flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-xs transition-colors",
                        logoChoice === c.url ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50"
                      )}
                    >
                      {/* Logos are made for light backgrounds - the PDF and the light panel. */}
                      <span className="flex h-16 items-center justify-center rounded-xl border border-border bg-white px-3">
                        {broken ? (
                          <span className="text-muted-foreground">Nie wczytuje się</span>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.url}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="max-h-12 max-w-full object-contain"
                            onError={() => setBrokenImages((list) => [...list, c.url])}
                          />
                        )}
                      </span>
                      <span className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="brand-fetch-logo"
                          value={c.url}
                          checked={logoChoice === c.url}
                          onChange={() => setLogoChoice(c.url)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{KIND_LABEL[c.kind]}</span>
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", CONFIDENCE[c.confidence].className)}>
                              {CONFIDENCE[c.confidence].label}
                            </span>
                          </span>
                          <span className="block text-muted-foreground">{c.label}</span>
                          <span className="block truncate text-muted-foreground" title={c.url}>
                            {c.url}
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="brand-fetch-logo"
                value={KEEP}
                checked={logoChoice === KEEP}
                onChange={() => setLogoChoice(KEEP)}
              />
              {currentLogoUrl ? "Zostaw obecne logo" : "Nie ustawiaj logo"}
            </label>
          </fieldset>

          {/* Colour options */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Kolor akcentu</legend>
            {preview.colorCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nie znaleziono koloru marki - wybierz go ręcznie.</p>
            ) : (
              preview.colorCandidates.map((c) => (
                <label key={c.color} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="brand-fetch-color"
                    value={c.color}
                    checked={colorChoice === c.color}
                    onChange={() => setColorChoice(c.color)}
                  />
                  {/* Same CSS variable the dashboard uses - no hex in markup. */}
                  <span
                    aria-hidden
                    style={clientAccentStyle(c.color)}
                    className="h-5 w-5 shrink-0 rounded border border-border bg-client-accent"
                  />
                  <span className="font-mono uppercase">{c.color}</span>
                  <span className="text-muted-foreground">- {c.label}</span>
                </label>
              ))
            )}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="brand-fetch-color"
                value={KEEP}
                checked={colorChoice === KEEP}
                onChange={() => setColorChoice(KEEP)}
              />
              {currentBrandColor ? "Zostaw obecny kolor" : "Nie ustawiaj koloru"}
            </label>
          </fieldset>

          {preview.notes.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {preview.notes.map((n) => (
                <li key={n} className="flex items-start gap-1.5">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={saving || nothingChosen} onClick={apply}>
              {saving ? "Zapisuję…" : "Zapisz"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setPreview(null)}>
              Anuluj
            </Button>
            {currentLogoUrl && logoChoice !== KEEP && logoChoice !== currentLogoUrl ? (
              <span className="text-xs text-muted-foreground">Zastąpi obecne logo.</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
