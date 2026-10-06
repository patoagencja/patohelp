"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  buildNav,
  findActive,
  TONE_TILE,
  type NavGroup,
  type NavItem,
} from "@/components/dashboard/nav-items";
import { cn } from "@/lib/utils";

/**
 * Settings-style sidebar: a short list of the main places (each with a tinted
 * icon tile and one plain line saying what is there), a collapsed "Więcej"
 * group for the rest, and agency tools at the bottom. The active place is a
 * raised white pill, so "where am I" is answered without reading.
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
  const main = groups.find((g) => g.id === "main");
  const more = groups.find((g) => g.id === "more");
  const agency = groups.find((g) => g.id === "agency");
  const moreHasActive = !!more?.items.some((i) => i.href === active?.href);
  const [moreOpen, setMoreOpen] = useState(moreHasActive);
  const moreId = useId();

  // Landing on a page inside "Więcej" (e.g. from ⌘K) reveals the group.
  useEffect(() => {
    if (moreHasActive) setMoreOpen(true);
  }, [moreHasActive]);

  return (
    <nav aria-label="Menu główne" className="flex flex-1 flex-col gap-6 px-3 pb-4 pt-2">
      {main ? (
        <ul className="space-y-1">
          {main.items.map((item) => (
            <li key={item.href}>
              <MainLink item={item} active={active?.href === item.href} suffix={linkSuffix} />
              {item.children?.length ? (
                <ul className="mt-0.5 space-y-0.5">
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <SubLink
                        item={child}
                        active={active?.href === child.href}
                        suffix={linkSuffix}
                        className="pl-[3.25rem]"
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
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
                moreOpen && "rotate-90"
              )}
              aria-hidden
            />
            {more.label}
          </button>
          <ul id={moreId} hidden={!moreOpen} className="mt-1 space-y-0.5">
            {more.items.map((item) => (
              <li key={item.href}>
                <SubLink item={item} active={active?.href === item.href} suffix={linkSuffix} withIcon />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {agency ? (
        <div className="mt-auto border-t border-border pt-4">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{agency.label}</p>
          <ul className="space-y-0.5">
            {agency.items.map((item) => (
              <li key={item.href}>
                <SubLink item={item} active={active?.href === item.href} suffix={linkSuffix} withIcon />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

function MainLink({ item, active, suffix }: { item: NavItem; active: boolean; suffix: string }) {
  const Icon = item.icon;
  return (
    <Link
      href={`${item.href}${suffix}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card shadow-card dark:bg-secondary"
          : "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem]",
          TONE_TILE[item.tone]
        )}
        aria-hidden
      >
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-[15px] leading-5",
            active ? "font-semibold text-foreground" : "font-medium text-foreground/90"
          )}
        >
          {item.label}
        </span>
        {item.description ? (
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function SubLink({
  item,
  active,
  suffix,
  withIcon = false,
  className,
}: {
  item: NavItem;
  active: boolean;
  suffix: string;
  withIcon?: boolean;
  className?: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={`${item.href}${suffix}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card font-semibold text-foreground shadow-card dark:bg-secondary"
          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-foreground/[0.06]",
        className
      )}
    >
      {withIcon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
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
