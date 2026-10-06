"use client";

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

  const href = (lang: "pl" | "en") => {
    const p = new URLSearchParams(sp.toString());
    if (lang === "en") p.set("lang", "en");
    else p.delete("lang");
    const q = p.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <div className={cn(segmentedTrack, "rounded-lg p-0.5")} role="group" aria-label="Język / Language">
      {(["pl", "en"] as const).map((l) => (
        <Link
          key={l}
          href={href(l)}
          aria-current={current === l ? "true" : undefined}
          lang={l}
          className={segmentedItem(current === l, "rounded-md px-2 py-1 text-xs uppercase")}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
