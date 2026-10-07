"use client";

import { useEffect, useRef, useState } from "react";
import { Film, GalleryHorizontalEnd, ImageIcon } from "lucide-react";

import {
  FORMAT_LABEL,
  guessFormat,
  type CreativeFormat,
  type Lang,
} from "@/lib/dashboard/creatives";
import { cn } from "@/lib/utils";

// Fills only (v2 tokens), one per format; the dots reuse .bg-dots with the
// format's own hue at low opacity.
const PLACEHOLDER_TINT: Record<CreativeFormat, string> = {
  image: "bg-lime-soft bg-dots [--stripe:var(--lime)_/_0.28]",
  video: "bg-olive-soft bg-dots [--stripe:var(--olive)_/_0.35]",
  carousel: "bg-ai-soft bg-dots [--stripe:var(--chart-4)_/_0.3]",
};

const FORMAT_ICON: Record<CreativeFormat, typeof Film> = {
  video: Film,
  carousel: GalleryHorizontalEnd,
  image: ImageIcon,
};

/**
 * Ad thumbnail with a neutral placeholder. Meta thumbnail URLs are signed and
 * expire, so a broken image is a normal state, not an edge case - we must
 * never show the browser's broken-image icon or alt text to a client.
 */
export function CreativeThumb({
  src,
  name,
  lang = "pl",
  className,
  fit = "cover",
  compact = false,
  format: formatHint,
  children,
}: {
  src: string | null;
  name: string;
  /** Known format (e.g. from 3-second video plays); else guessed from the name. */
  format?: CreativeFormat;
  lang?: Lang;
  className?: string;
  fit?: "cover" | "contain";
  /** Icon-only placeholder for small thumbs (tables, lists). */
  compact?: boolean;
  /** Overlays (rank badges etc.) rendered above the image. */
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(!src);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(!src);
  }, [src]);

  // The image can fail before hydration attaches onError; catch that case.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  const format = formatHint ?? guessFormat(name);
  const Icon = FORMAT_ICON[format];

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-[18px] bg-chip",
        className
      )}
    >
      {!failed && src ? (
        // Remote Meta CDN URLs with rotating hosts - next/image would need an
        // open remotePatterns allowlist, so a plain lazy <img> is the safer fit.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full",
            fit === "cover" ? "object-cover" : "object-contain"
          )}
        />
      ) : (
        // No image (expired Meta URL, or none synced yet): a calm tinted
        // tile per format with a faint dot pattern, so a missing thumbnail
        // reads as a deliberate "Wideo / Grafika" card, not a broken image.
        // Icon and label sit on glass chips (board `.play`), which keeps
        // them legible inside the anchor (podium #1) surface too.
        <div
          // Plain string, not cn(): tailwind-merge would drop the tint as a
          // "conflict" with bg-dots.
          className={`flex h-full w-full flex-col items-center justify-center gap-2 ${PLACEHOLDER_TINT[format]}`}
          role="img"
          aria-label={`${FORMAT_LABEL[lang][format]} · Meta`}
        >
          {compact ? (
            <Icon className="h-4 w-4 text-foreground/70" aria-hidden />
          ) : (
            <>
              <span className="glass-tip flex h-11 w-11 items-center justify-center rounded-full">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              {/* thumb-label: callers with a small thumb can hide it. */}
              <span className="thumb-label glass-tip rounded-full px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]">
                {FORMAT_LABEL[lang][format]} · Meta
              </span>
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
