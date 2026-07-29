"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

// PL / EN switch for the demo. Toggles the ?lang= param on the current path.
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
    <div className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
      {(["pl", "en"] as const).map((l) => (
        <Link
          key={l}
          href={href(l)}
          className={cn(
            "rounded-md px-2 py-1 uppercase transition-colors",
            current === l
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
