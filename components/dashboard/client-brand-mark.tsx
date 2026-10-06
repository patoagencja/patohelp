"use client";

import { useEffect, useRef, useState } from "react";

import { clientLogo } from "@/components/dashboard/client-logo";
import { cn } from "@/lib/utils";

/** "DRE Sp. z o.o." -> "DS"; used when there is no logo of any kind. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.trim().slice(0, 2);
  return letters.toUpperCase() || "?";
}

/**
 * The client's mark wherever their name heads a screen or a page: their own
 * uploaded logo (clients.logo_url) first, then the hard-coded SVG wordmark for
 * known slugs, then `fallback` (or initials). A broken or blocked logo URL
 * must never leave an empty box in front of a board, hence the onError
 * fallback rather than trusting the URL.
 *
 * `className` sizes the logo (e.g. "h-6"); the image keeps its aspect ratio.
 */
export function ClientBrandMark({
  name,
  slug,
  logoUrl,
  className,
  fallback,
}: {
  name: string;
  slug?: string;
  logoUrl?: string | null;
  className?: string;
  /** Shown when neither an uploaded nor a built-in logo exists. */
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A new URL (settings preview, client switch) deserves a fresh attempt.
    setFailed(false);
    // The server-rendered <img> may have failed before hydration attached
    // onError; decode() rejects for an image that is already broken.
    const img = imgRef.current;
    if (img?.complete) img.decode().catch(() => setFailed(true));
  }, [logoUrl]);

  if (logoUrl && !failed) {
    return (
      // External, arbitrary host: next/image would need every client's CDN
      // whitelisted in next.config.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={logoUrl}
        alt={name}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn("block w-auto max-w-full object-contain", className)}
      />
    );
  }

  const Logo = slug ? clientLogo(slug) : null;
  if (Logo) return <Logo className={cn("w-auto", className)} />;
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex aspect-square items-center justify-center rounded-lg bg-primary px-1 text-xs font-bold text-primary-foreground",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
