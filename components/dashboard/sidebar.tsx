"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, HelpCircle } from "lucide-react";

import {
  buildNav,
  findActive,
  findSection,
  HELP_EVENT,
  type NavGroup,
  type NavItem,
} from "@/components/dashboard/nav-items";
import { cn } from "@/lib/utils";

const rowBase =
  "flex w-full items-center gap-3 rounded-xl px-3 text-sm transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const rowIdle =
  "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground dark:hover:bg-foreground/[0.07]";
// The one raised element in the sidebar: a white pill, like the selected
// segment of a segmented control. The icon takes the accent colour.
const rowActive = "bg-card font-medium text-foreground shadow-card dark:bg-secondary";

/**
 * Dimmed sidebar so the content wins: muted monochrome items, four places
 * plus a collapsible "Więcej", agency tools pinned to the bottom. Sub-pages
 * (Kreacje under Reklamy) appear only while you are in that place.
 */
export function SidebarNav({
  groups,
  base,
  linkSuffix = "",
}: {
  groups: NavGroup[];
  base: string;
  /** Appended to every href (the demo keeps its ?lang= switch). */
  linkSuffix?: string;
}) {
  const pathname = usePathname();
  const active = findActive(groups, pathname, base);
  const section = findSection(groups, active);
  const main = groups.find((g) => g.id === "main");
  const more = groups.find((g) => g.id === "more");
  const agency = groups.find((g) => g.id === "agency");
  const moreHasActive = !!more && more.items.some((i) => i.href === active?.href);
  const [moreOpen, setMoreOpen] = useState(moreHasActive);
  const moreId = useId();

  // Landing on a page inside "Więcej" (e.g. from ⌘K) reveals the group.
  useEffect(() => {
    if (moreHasActive) setMoreOpen(true);
  }, [moreHasActive]);

  return (
    <nav aria-label="Menu główne" className="flex flex-1 flex-col gap-5 px-3 pb-4 pt-1">
      {main ? (
        <ul className="space-y-0.5">
          {main.items.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={active?.href === item.href} suffix={linkSuffix} />
              {item.children?.length && section?.href === item.href ? (
                <ul className="mt-0.5 space-y-0.5">
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <NavLink
                        item={child}
                        active={active?.href === child.href}
                        suffix={linkSuffix}
                        sub
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {more ? (
        <div>
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            className={cn(rowBase, rowIdle, "h-9")}
          >
            <ChevronRight
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                moreOpen && "rotate-90"
              )}
              aria-hidden
            />
            {more.label}
          </button>
          <ul id={moreId} hidden={!moreOpen} className="mt-0.5 space-y-0.5">
            {more.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={active?.href === item.href} suffix={linkSuffix} sub />
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(HELP_EVENT))}
                className={cn(rowBase, rowIdle, "h-9 pl-10")}
              >
                <HelpCircle className="h-4 w-4 shrink-0" aria-hidden />
                Jak czytać panel
              </button>
            </li>
          </ul>
        </div>
      ) : null}

      {agency ? (
        <div className="mt-auto border-t border-border pt-3">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{agency.label}</p>
          <ul className="space-y-0.5">
            {agency.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={active?.href === item.href} suffix={linkSuffix} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

function NavLink({
  item,
  active,
  suffix,
  sub = false,
}: {
  item: NavItem;
  active: boolean;
  suffix: string;
  /** Second-level row: indented under its parent, smaller icon. */
  sub?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={`${item.href}${suffix}`}
      aria-current={active ? "page" : undefined}
      className={cn(rowBase, sub ? "h-9 pl-10" : "h-10", active ? rowActive : rowIdle)}
    >
      <Icon
        className={cn(
          "shrink-0",
          sub ? "h-4 w-4" : "h-[18px] w-[18px]",
          active && "text-primary"
        )}
        aria-hidden
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function DashboardSidebar({
  clientSlug,
  isAgency,
  isEcommerce = false,
}: {
  clientSlug: string;
  isAgency: boolean;
  isEcommerce?: boolean;
}) {
  const base = `/${clientSlug}`;
  return <SidebarNav groups={buildNav({ base, isEcommerce, isAgency })} base={base} />;
}
