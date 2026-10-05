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
  children,
}: {
  src: string | null;
  name: string;
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

  const format = guessFormat(name);
  const Icon = FORMAT_ICON[format];

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl bg-muted",
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
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-muted to-muted-foreground/10 text-muted-foreground"
          role="img"
          aria-label={`${FORMAT_LABEL[lang][format]} · Meta`}
        >
          <Icon className={compact ? "h-4 w-4" : "h-7 w-7"} aria-hidden />
          {compact ? null : (
            <span className="text-[11px] font-medium uppercase tracking-wide">
              {FORMAT_LABEL[lang][format]} · Meta
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
