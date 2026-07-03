"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Globe,
  LayoutDashboard,
  Megaphone,
  Settings,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";

export function DashboardSidebar({
  clientSlug,
  isAgency,
}: {
  clientSlug: string;
  isAgency: boolean;
}) {
  const pathname = usePathname();
  const base = `/${clientSlug}`;

  const items = [
    { href: base, label: "Przegląd", icon: LayoutDashboard },
    { href: `${base}/reklamy`, label: "Reklamy", icon: Megaphone },
    { href: `${base}/witryna`, label: "Witryna", icon: Globe },
    { href: `${base}/asystent`, label: "Asystent AI", icon: Sparkles },
    ...(isAgency
      ? [{ href: `${base}/settings`, label: "Ustawienia", icon: Settings }]
      : []),
  ];

  return (
    <nav className="flex flex-col gap-1 p-3">
      <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Menu
      </p>
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
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
