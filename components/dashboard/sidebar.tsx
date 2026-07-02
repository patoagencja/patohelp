"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
    { href: `${base}/kampanie`, label: "Kampanie", icon: Megaphone },
    { href: `${base}/asystent`, label: "Asystent AI", icon: Sparkles },
    ...(isAgency
      ? [{ href: `${base}/settings`, label: "Ustawienia", icon: Settings }]
      : []),
  ];

  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
