"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, HelpCircle, LogOut, Moon, MoreHorizontal, Printer, Search, Sun } from "lucide-react";

import { HELP_EVENT } from "@/components/dashboard/nav-items";
import { useThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
export function AlertsBell({ href, count = 0 }: { href: string; count?: number }) {
  const label = count > 0 ? `Alerty - do sprawdzenia: ${count}` : "Alerty";
  return (
    <Button asChild variant="outline" size="icon" className="relative">
      <Link href={href} aria-label={label} title={label}>
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums ring-[2.5px] ring-background"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

export function HeaderMenu({
  overviewPath,
  email,
  signOut,
}: {
  /** The guided tour's targets live on the overview. */
  overviewPath: string;
  email?: string | null;
  /** Server Action; renders "Wyloguj" when given. */
  signOut?: () => Promise<void>;
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

  const openSearch = () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: isMac, ctrlKey: !isMac, bubbles: true })
    );

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
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Więcej opcji"
        title="Więcej opcji"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(open && "bg-foreground/[0.06]")}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </Button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Więcej opcji"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-2xl border border-hairline bg-popover p-1.5 text-popover-foreground shadow-raised animate-in fade-in-0 zoom-in-95 duration-100 motion-reduce:animate-none"
        >
          {email ? (
            <p className="truncate px-3 pb-2 pt-1.5 text-xs text-muted-foreground" title={email}>
              Zalogowano jako <span className="font-medium text-foreground">{email}</span>
            </p>
          ) : null}
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
