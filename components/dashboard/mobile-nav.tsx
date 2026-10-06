"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, HelpCircle, MoreHorizontal, X } from "lucide-react";

import {
  buildNav,
  findActive,
  findSection,
  HELP_EVENT,
  type NavItem,
} from "@/components/dashboard/nav-items";
import { useModalFocus } from "@/components/dashboard/use-modal-focus";
import { cn } from "@/lib/utils";

/**
 * Phone navigation (Telefon-2030): a floating glass tab bar with a sliding
 * ink indicator - the main places (at most four) plus "Więcej" opening a
 * sheet with everything else. Same model as the desktop top bar
 * (nav-items.ts), so both always list the same pages. Below `md` only.
 */
export function MobileNav({
  clientSlug,
  isAgency,
  isEcommerce = false,
  omit = [],
}: {
  clientSlug: string;
  isAgency: boolean;
  isEcommerce?: boolean;
  /** Tab hrefs to leave out (the public demo has no report tab). */
  omit?: string[];
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  // Keep the demo's language switch when hopping between tabs.
  const suffix = sp.get("lang") === "en" ? "?lang=en" : "";
  const [open, setOpen] = useState(false);
  const base = `/${clientSlug}`;
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useModalFocus(sheetRef, open, close, closeRef);

  // Close the sheet whenever navigation happens.
  useEffect(() => setOpen(false), [pathname]);

  const groups = buildNav({ base, isEcommerce, isAgency, omit });
  const active = findActive(groups, pathname, base);
  // Kreacje lights up the Reklamy tab: it is a part of that place.
  const section = findSection(groups, active);
  const mainItems = groups.find((g) => g.id === "main")?.items ?? [];
  const primary = mainItems.slice(0, 4);
  // Sub-pages (Kreacje) and any overflow go to the sheet, ahead of "Więcej".
  const sheetSections: { label?: string; items: NavItem[] }[] = [
    {
      label: "Reklamy",
      items: [...mainItems.slice(4), ...mainItems.flatMap((i) => i.children ?? [])],
    },
    ...groups
      .filter((g) => g.id !== "main")
      .map((g) => ({ label: g.id === "more" ? undefined : g.label, items: g.items })),
  ].filter((s) => s.items.length > 0);
  const moreActive = !!section && !primary.some((i) => i.href === section.href);
  const slots = primary.length + 1;
  const activeSlot = moreActive ? primary.length : primary.findIndex((i) => i.href === section?.href);

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Więcej">
          {/* Tap-outside target only; keyboard users have the X and Esc. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px] animate-in fade-in motion-reduce:animate-none dark:bg-black/50"
          />
          <div
            ref={sheetRef}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] max-w-xl overflow-y-auto rounded-t-[2rem] bg-background p-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] shadow-raised animate-in slide-in-from-bottom-8 motion-reduce:animate-none"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-foreground/15" aria-hidden />
            <div className="flex items-center justify-between px-1 pb-3">
              <h2 className="text-lg font-semibold">Więcej</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-chip text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Zamknij"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="space-y-5">
              {sheetSections.map((section, si) => (
                <div key={section.label ?? `s${si}`}>
                  {section.label ? (
                    <p className="px-4 pb-1.5 text-xs font-medium text-muted-foreground">{section.label}</p>
                  ) : null}
                  {/* Inset grouped list: one white surface, hairline rows. */}
                  <ul className="glass divide-y divide-border overflow-hidden rounded-[22px]">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = active?.href === item.href;
                      return (
                        <li key={item.href}>
                          <Link
                            href={`${item.href}${suffix}`}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              // Active row = the anchor pill language of the
                              // sidebar and tab bar (fill + weight + dot,
                              // never colour alone; aria-current for AT).
                              isActive
                                ? "bg-anchor text-anchor-foreground focus-visible:ring-anchor-dot"
                                : "active:bg-muted"
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-5 w-5 shrink-0",
                                isActive ? "text-anchor-foreground" : "text-muted-foreground"
                              )}
                              aria-hidden
                            />
                            <span className={cn("flex-1", isActive ? "font-semibold" : "font-medium")}>
                              {item.label}
                            </span>
                            {isActive ? (
                              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-anchor-dot" />
                            ) : null}
                            <ChevronRight
                              className={cn(
                                "h-4 w-4",
                                isActive ? "text-anchor-foreground/60" : "text-muted-foreground"
                              )}
                              aria-hidden
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  close();
                  window.dispatchEvent(new Event(HELP_EVENT));
                }}
                className="glass flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
              >
                <HelpCircle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                Jak czytać panel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Nawigacja"
        className="glass glass-blur fixed inset-x-3.5 bottom-[calc(14px+env(safe-area-inset-bottom))] z-50 h-[70px] rounded-full p-[7px] md:hidden print:hidden"
      >
        <div className="relative grid h-full" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {/* The sliding "sel" pill: equal columns, so it moves by its own
              width. Hidden when no tab is current (e.g. Ustawienia). */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0 rounded-full bg-anchor shadow-[0_4px_14px_-6px_rgb(40_36_28/0.35)] transition-transform duration-[550ms] [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none",
              activeSlot < 0 && "opacity-0"
            )}
            style={{
              width: `${100 / slots}%`,
              transform: `translateX(${Math.max(0, activeSlot) * 100}%)`,
            }}
          />
          {primary.map(({ href, label, short, icon: Icon }) => {
            const isActive = section?.href === href;
            return (
              <Link
                key={href}
                href={`${href}${suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-[3px] rounded-full text-[11px] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive ? "text-anchor-foreground focus-visible:ring-anchor-dot" : "text-ink-2"
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden />
                <span className="max-w-full truncate px-1">{short ?? label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={cn(
              "relative flex flex-col items-center justify-center gap-[3px] rounded-full text-[11px] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              moreActive && !open ? "text-anchor-foreground" : open ? "text-foreground" : "text-ink-2"
            )}
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.8} aria-hidden />
            <span>Więcej</span>
          </button>
        </div>
      </nav>
    </>
  );
}
