"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BellRing,
  BookOpen,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  Megaphone,
  Newspaper,
  ShoppingBag,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/demo-full", label: "Przegląd", icon: LayoutDashboard },
  // Same slot as in the real sidebar for e-commerce clients.
  { href: "/demo-full/sprzedaz", label: "Sprzedaż", icon: ShoppingBag },
  { href: "/demo-full/reklamy", label: "Reklamy", icon: Megaphone },
  { href: "/demo-full/kreacje", label: "Kreacje", icon: ImageIcon },
  { href: "/demo-full/witryna", label: "Witryna", icon: Globe },
  { href: "/demo-full/alerty", label: "Alerty", icon: BellRing },
  { href: "/demo-full/newsy", label: "Newsy", icon: Newspaper },
  { href: "/demo-full/slowniczek", label: "Słowniczek", icon: BookOpen },
];

export function DemoSidebar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const suffix = sp.get("lang") === "en" ? "?lang=en" : "";
  return (
    <nav aria-label="Menu główne" className="flex flex-col gap-1 p-3">
      <p aria-hidden className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Menu
      </p>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={`${href}${suffix}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
