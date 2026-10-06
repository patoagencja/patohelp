"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  MoreHorizontal,
  Newspaper,
  Settings,
  ShoppingBag,
  X,
} from "lucide-react";

import { useModalFocus } from "@/components/dashboard/use-modal-focus";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: typeof LayoutDashboard };

/**
 * Phone navigation as a bottom tab bar (thumb reach, like native apps): the
 * four most used tabs plus "Więcej" opening a sheet with the rest. The old
 * top strip of 8+ chips had to be swiped to find anything.
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
  const [open, setOpen] = useState(false);
  const base = `/${clientSlug}`;
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useModalFocus(sheetRef, open, close, closeRef);

  // Close the sheet whenever navigation happens.
  useEffect(() => setOpen(false), [pathname]);

  const primary: Item[] = [
    { href: base, label: "Przegląd", icon: LayoutDashboard },
    isEcommerce
      ? { href: `${base}/sprzedaz`, label: "Sprzedaż", icon: ShoppingBag }
      : { href: `${base}/reklamy`, label: "Reklamy", icon: Megaphone },
    { href: `${base}/kreacje`, label: "Kreacje", icon: ImageIcon },
    { href: `${base}/witryna`, label: "Strona", icon: Globe },
  ];
  const more: Item[] = [
    ...(isEcommerce ? [{ href: `${base}/reklamy`, label: "Reklamy", icon: Megaphone }] : []),
    { href: `${base}/alerty`, label: "Alerty", icon: BellRing },
    { href: `${base}/raport`, label: "Raport", icon: FileText },
    { href: `${base}/newsy`, label: "Newsy", icon: Newspaper },
    ...(isAgency
      ? [
          { href: `${base}/settings`, label: "Ustawienia", icon: Settings },
          { href: `/clients`, label: "Wszyscy klienci", icon: LayoutGrid },
        ]
      : []),
  ];
  const moreItems = more.filter((i) => !omit.includes(i.href));
  const moreActive = moreItems.some((i) => i.href === pathname);

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
            className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-in fade-in motion-reduce:animate-none"
          />
          <div
            ref={sheetRef}
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-border bg-card p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom-8 motion-reduce:animate-none"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" aria-hidden />
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-sm font-semibold">Więcej</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Zamknij"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {moreItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    pathname === href
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted/50 text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Nawigacja"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden print:hidden"
      >
        <div className="grid grid-cols-5">
          {primary.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "text-primary dark:text-indigo-300" : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-primary/10"
                  )}
                >
                  <Icon className="h-[19px] w-[19px]" aria-hidden />
                </span>
                {label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              open || moreActive ? "text-primary dark:text-indigo-300" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                (open || moreActive) && "bg-primary/10"
              )}
            >
              <MoreHorizontal className="h-[19px] w-[19px]" aria-hidden />
            </span>
            Więcej
          </button>
        </div>
      </nav>
    </>
  );
}
