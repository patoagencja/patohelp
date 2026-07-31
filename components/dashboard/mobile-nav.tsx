"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  Newspaper,
  Settings,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";

// Horizontal, swipeable nav shown only on mobile (the sidebar is md:flex).
// Mirrors the sidebar's items so phone users can reach every tab.
export function MobileNav({
  clientSlug,
  isAgency,
  isEcommerce = false,
}: {
  clientSlug: string;
  isAgency: boolean;
  isEcommerce?: boolean;
}) {
  const pathname = usePathname();
  const base = `/${clientSlug}`;

  const items = [
    { href: base, label: "Przegląd", icon: LayoutDashboard },
    ...(isEcommerce
      ? [{ href: `${base}/sprzedaz`, label: "Sprzedaż", icon: ShoppingBag }]
      : []),
    { href: `${base}/reklamy`, label: "Reklamy", icon: Megaphone },
    { href: `${base}/kreacje`, label: "Kreacje", icon: ImageIcon },
    { href: `${base}/witryna`, label: "Witryna", icon: Globe },
    { href: `${base}/alerty`, label: "Alerty", icon: BellRing },
    { href: `${base}/raport`, label: "Raport", icon: FileText },
    { href: `${base}/newsy`, label: "Newsy", icon: Newspaper },
    { href: `${base}/asystent`, label: "Asystent", icon: Sparkles },
    ...(isAgency
      ? [
          { href: `${base}/settings`, label: "Ustawienia", icon: Settings },
          { href: `/clients`, label: "Klienci", icon: LayoutGrid },
        ]
      : []),
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
