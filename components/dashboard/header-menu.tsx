"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, HelpCircle, LogOut, Moon, MoreHorizontal, Printer, Search, Sun } from "lucide-react";

import { buildNav, findActive, HELP_EVENT, topNavItems } from "@/components/dashboard/nav-items";
import { useThemeToggle } from "@/components/dashboard/theme-toggle";
import { CountBadge, iconButton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/** Opens the ⌘K command palette (it listens for the shortcut on window). */
export function openCommandPalette() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: mac, ctrlKey: !mac, bubbles: true })
  );
}

/** The chrome's search / ask button (44px chip): opens the command palette. */
export function SearchButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Szukaj i pytaj (⌘K)"
      title="Szukaj w panelu (⌘K)"
      className={cn(iconButton, className)}
    >
      <Search aria-hidden strokeWidth={1.8} />
    </button>
  );
}

/**
 * The header's one overflow menu. A first-time visitor sees at most
 * "Prezentuj" and this "…"; search (⌘K), the guided tour, PDF, theme and
 * sign-out live here. The actions are fired through the same window events /
 * shortcuts the command palette uses, so CommandPalette and GuidedTour keep
 * owning their overlays and only their header triggers are hidden.
 *
 * Owns the theme state for the page: don't also mount <ThemeToggle/>.
 */
/** Alerts one tap away from every page (the Alerty page itself sits under
 *  "Więcej"). `count` = alerts that need a look (Pilne + Ważne); the badge
 *  shows only when there are any, so a calm account has a plain bell. */
export function AlertsBell({
  href,
  count = 0,
  className,
}: {
  href: string;
  count?: number;
  className?: string;
}) {
  const label = count > 0 ? `Alerty - do sprawdzenia: ${count}` : "Alerty";
  return (
    <Link href={href} aria-label={label} title={label} className={cn(iconButton, className)}>
      <Bell aria-hidden strokeWidth={1.8} />
      <CountBadge count={count} />
    </Link>
  );
}

export function HeaderMenu({
  overviewPath,
  email,
  signOut,
  isEcommerce = false,
  isAgency = false,
  omit = [],
}: {
  /** The guided tour's targets live on the overview. */
  overviewPath: string;
  email?: string | null;
  /** Server Action; renders "Wyloguj" when given. */
  signOut?: () => Promise<void>;
  /** Nav model inputs: pages that aren't in the top bar are listed here. */
  isEcommerce?: boolean;
  isAgency?: boolean;
  omit?: string[];
}) {
  const { dark, toggle } = useThemeToggle();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingTour = useRef(false);
  const menuId = useId();

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // Focus the first item on open; close on outside click.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  // Tour requested away from the overview: start it once we're there.
  useEffect(() => {
    if (!pendingTour.current || pathname !== overviewPath) return;
    pendingTour.current = false;
    const t = setTimeout(() => window.dispatchEvent(new Event("pato:tour")), 900);
    return () => clearTimeout(t);
  }, [pathname, overviewPath]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  const run = (fn: () => void) => () => {
    // Focus goes back to the trigger first, so overlays opened next (palette,
    // tour) return focus there when they close.
    close();
    fn();
  };

  const openSearch = openCommandPalette;

  // Everything the top bar doesn't show (Raporty, Newsy, Słowniczek, agency
  // tools): same model as the bar, the phone sheet and the palette.
  const groups = buildNav({ base: overviewPath, isEcommerce, isAgency, omit });
  const inBar = new Set(topNavItems(groups).map((i) => i.href));
  const active = findActive(groups, pathname, overviewPath);
  const pages = groups
    .filter((g) => g.id !== "agency")
    .flatMap((g) => g.items)
    .filter((i) => !inBar.has(i.href));
  const agency = groups.find((g) => g.id === "agency")?.items ?? [];

  const startTour = useCallback(() => {
    if (pathname === overviewPath) {
      window.dispatchEvent(new Event("pato:tour"));
    } else {
      pendingTour.current = true;
      const lang = new URLSearchParams(window.location.search).get("lang");
      router.push(lang ? `${overviewPath}?lang=${encodeURIComponent(lang)}` : overviewPath);
    }
  }, [pathname, overviewPath, router]);

  // "Jak czytać panel" in the sidebar / phone sheet routes through here.
  useEffect(() => {
    window.addEventListener(HELP_EVENT, startTour);
    return () => window.removeEventListener(HELP_EVENT, startTour);
  }, [startTour]);

  const itemClass =
    "flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-chip focus-visible:bg-chip focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Więcej opcji"
        title="Więcej opcji"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(iconButton, "bg-transparent", open && "bg-chip")}
      >
        <MoreHorizontal aria-hidden strokeWidth={1.8} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Więcej opcji"
          onKeyDown={onMenuKey}
          className="glass-tip absolute right-0 top-full z-50 mt-3 !bg-popover/95 max-h-[calc(100vh-6rem)] w-64 origin-top-right overflow-y-auto rounded-[22px] p-1.5 animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
        >
          {email ? (
            <p className="truncate px-3 pb-2 pt-1.5 text-xs text-muted-foreground" title={email}>
              Zalogowano jako <span className="font-medium text-foreground">{email}</span>
            </p>
          ) : null}
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <Link
                key={p.href}
                href={p.href}
                role="menuitem"
                tabIndex={-1}
                aria-current={active?.href === p.href ? "page" : undefined}
                className={cn(itemClass, active?.href === p.href && "font-semibold")}
                onClick={() => close(false)}
              >
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                {p.label}
              </Link>
            );
          })}
          {pages.length > 0 ? <div role="separator" className="mx-3 my-1.5 h-px bg-border" /> : null}
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={run(openSearch)}>
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">Szukaj</span>
            <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={run(startTour)}>
            <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
            Jak czytać panel
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={itemClass}
            // Let the menu unmount before the browser snapshots the page.
            onClick={run(() => setTimeout(() => window.print(), 80))}
          >
            <Printer className="h-4 w-4 text-muted-foreground" aria-hidden />
            Pobierz PDF
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={run(toggle)}>
            {dark ? (
              <Sun className="h-4 w-4 text-muted-foreground" aria-hidden />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" aria-hidden />
            )}
            {dark ? "Tryb jasny" : "Tryb ciemny"}
          </button>
          {agency.length > 0 ? (
            <>
              <div role="separator" className="mx-3 my-1.5 h-px bg-border" />
              <p className="px-3 pb-1 pt-1 text-xs font-medium text-muted-foreground">Agencja</p>
              {agency.map((p) => {
                const Icon = p.icon;
                return (
                  <Link
                    key={p.href}
                    href={p.href}
                    role="menuitem"
                    tabIndex={-1}
                    className={itemClass}
                    onClick={() => close(false)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {p.label}
                  </Link>
                );
              })}
            </>
          ) : null}
          {signOut ? (
            <>
              <div role="separator" className="mx-3 my-1.5 h-px bg-border" />
              <form action={signOut}>
                <button type="submit" role="menuitem" tabIndex={-1} className={itemClass}>
                  <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Wyloguj
                </button>
              </form>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
