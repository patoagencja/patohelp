"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BellRing,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  Megaphone,
  Newspaper,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/demo-full", label: "Przegląd", icon: LayoutDashboard },
  { href: "/demo-full/reklamy", label: "Reklamy", icon: Megaphone },
  { href: "/demo-full/kreacje", label: "Kreacje", icon: ImageIcon },
  { href: "/demo-full/witryna", label: "Witryna", icon: Globe },
  { href: "/demo-full/alerty", label: "Alerty", icon: BellRing },
  { href: "/demo-full/newsy", label: "Newsy", icon: Newspaper },
];

export function DemoSidebar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const suffix = sp.get("lang") === "en" ? "?lang=en" : "";
  return (
    <nav className="flex flex-col gap-1 p-3">
      <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Menu
      </p>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={`${href}${suffix}`}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
