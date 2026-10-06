"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

// PL / EN switch for the demo. Toggles the ?lang= param on the current path.
// Shares the segmented-control recipe so the selected chip is raised above
// the track in both themes (bg-card sat below bg-muted in dark mode).
export function LangToggle() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get("lang") === "en" ? "en" : "pl";

  // <html lang="pl"> comes from the root layout, which can't see ?lang=.
  // The demo's chrome stays Polish but the page body switches, so mark
  // <main> - otherwise screen readers read the English demo with Polish
  // pronunciation.
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    if (current === "en") main.setAttribute("lang", "en");
    else main.removeAttribute("lang");
    return () => main.removeAttribute("lang");
  }, [current, pathname]);

  const href = (lang: "pl" | "en") => {
    const p = new URLSearchParams(sp.toString());
    if (lang === "en") p.set("lang", "en");
    else p.delete("lang");
    const q = p.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <div className={cn(segmentedTrack, "p-0.5")} role="group" aria-label="Język / Language">
      {(["pl", "en"] as const).map((l) => (
        <Link
          key={l}
          href={href(l)}
          aria-current={current === l ? "true" : undefined}
          lang={l}
          className={segmentedItem(current === l, "px-2.5 py-1 text-xs uppercase")}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
