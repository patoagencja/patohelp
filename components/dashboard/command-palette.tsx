"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  BellRing,
  Building2,
  CalendarRange,
  Check,
  CornerDownLeft,
  FileText,
  Globe,
  HelpCircle,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  MonitorPlay,
  Newspaper,
  Printer,
  Search,
  Settings,
  ShoppingBag,
  SunMoon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { RANGE_KEYS, RANGE_LABELS } from "@/lib/dashboard/ranges";
import { cn } from "@/lib/utils";

/**
 * ⌘K / Ctrl+K command palette (Linear/Vercel style): jump between tabs,
 * clients and date ranges, or fire the header actions, without the mouse.
 *
 * Header actions living in other components (presentation, tour, theme) are
 * triggered through window events they listen to, so neither side needs to
 * share state or be re-parented.
 */

export const PALETTE_EVENTS = {
  present: "pato:present",
  tour: "pato:tour",
  theme: "pato:toggle-theme",
} as const;

type Icon = typeof LayoutDashboard;

type GroupKey = "recent" | "nav" | "clients" | "range" | "actions";

const GROUP_LABELS: Record<GroupKey, string> = {
  recent: "Ostatnio używane",
  nav: "Przejdź do",
  clients: "Klienci",
  range: "Zakres dat",
  actions: "Akcje",
};

const GROUP_ORDER: GroupKey[] = ["recent", "nav", "clients", "range", "actions"];

interface Command {
  /** Stable across clients/pages so "recent" survives switching clients. */
  id: string;
  group: Exclude<GroupKey, "recent">;
  label: string;
  /** Extra search terms (synonyms, English) that are never displayed. */
  keywords?: string;
  hint?: string;
  icon: Icon;
  /** Marks where the user already is (current tab, client, range). */
  current?: boolean;
  run: () => void;
}

interface Row {
  key: string; // DOM id suffix; recent rows duplicate commands, so ids differ
  group: GroupKey;
  command: Command;
  score: number;
  match: [number, number] | null;
}

const RECENT_KEY = "pato:cmdk-recent";
const RECENT_MAX = 3;

// Tabs whose pages ignore ?range= - picking a range there lands on the
// overview instead of silently doing nothing. Sezon is framed by the season
// window itself (lib/season), not by a date range.
const NO_RANGE_TABS = new Set(["alerty", "newsy", "settings", "sezon"]);

// One output char per input char keeps match indices valid for highlighting
// the original (accented) label. "ł" has no Unicode decomposition, hence the
// explicit mapping.
function foldChar(c: string): string {
  if (c === "ł" || c === "Ł") return "l";
  const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return base.length === 1 ? base : c.toLowerCase().charAt(0) || c;
}

function fold(s: string): string {
  let out = "";
  for (const c of s) out += foldChar(c);
  return out;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** Higher is better; null = no match. Tuned for short Polish labels. */
function scoreCommand(
  q: string,
  cmd: Command
): { score: number; match: [number, number] | null } | null {
  if (!q) return { score: 1, match: null };
  const label = fold(cmd.label);
  const idx = label.indexOf(q);
  if (idx === 0) return { score: 100, match: [0, q.length] };
  if (idx > 0) {
    const wordStart = /[\s(/-]/.test(label[idx - 1]);
    return { score: wordStart ? 80 : 60, match: [idx, idx + q.length] };
  }
  const hay = `${label} ${fold(cmd.keywords ?? "")} ${fold(cmd.hint ?? "")}`;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.every((t) => hay.includes(t))) return { score: 40, match: null };
  if (q.length >= 2 && isSubsequence(q.replace(/\s+/g, ""), label)) {
    return { score: 20, match: null };
  }
  return null;
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode - recents are a nicety.
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [role='combobox']"));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Highlight({ text, match }: { text: string; match: [number, number] | null }) {
  if (!match) return <>{text}</>;
  // Map folded indices back to code points (fold is 1:1 per code point).
  const chars = Array.from(text);
  return (
    <>
      {chars.slice(0, match[0]).join("")}
      <mark className="rounded-sm bg-lime/35 text-foreground">
        {chars.slice(match[0], match[1]).join("")}
      </mark>
      {chars.slice(match[1]).join("")}
    </>
  );
}

export function CommandPalette({
  clientSlug,
  isAgency,
  isEcommerce = false,
  isSeasonal = false,
  clients = null,
  omit = [],
}: {
  clientSlug: string;
  isAgency: boolean;
  isEcommerce?: boolean;
  /** clients.season is set: the Sezon view exists. */
  isSeasonal?: boolean;
  /** Agency only: every client, same list the ClientSwitcher gets. */
  clients?: Array<{ slug: string; name: string }> | null;
  /** Tab hrefs to leave out (the public demo has no report tab). */
  omit?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [currentRange, setCurrentRange] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [pending, startTransition] = useTransition();
  const rangePendingRef = useRef(false);
  const pendingTourRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const titleId = `${uid}-title`;
  const optionId = (key: string) => `${uid}-opt-${key}`;

  const base = `/${clientSlug}`;

  useEffect(() => {
    setMounted(true);
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);

  const openPalette = useCallback(() => {
    // Another modal (guided tour, mobile sheet) owns the keyboard and focus.
    const otherModal = Array.from(document.querySelectorAll("[aria-modal='true']")).some(
      (el) => !panelRef.current?.contains(el)
    );
    if (otherModal) return;
    const el = document.activeElement;
    returnFocusRef.current = el instanceof HTMLElement && el !== document.body ? el : null;
    const params = new URLSearchParams(window.location.search);
    setCurrentRange(params.get("from") && params.get("to") ? "custom" : params.get("range") ?? "30d");
    setIsDark(document.documentElement.classList.contains("dark"));
    setRecent(readRecent());
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback((restoreFocus = true) => {
    setOpen(false);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    // Synchronous so a follow-up action (tour) sees the real prior focus,
    // not our input that is about to unmount.
    if (restoreFocus && back?.isConnected) back.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  // Global shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
        return;
      }
      if (
        e.key === "/" &&
        !open &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        openPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette, closePalette]);

  // Mirror the date picker: dim <main> while a range change is loading.
  useEffect(() => {
    if (!rangePendingRef.current) return;
    const root = document.documentElement;
    if (pending) {
      root.dataset.pending = "true";
    } else {
      delete root.dataset.pending;
      rangePendingRef.current = false;
    }
  }, [pending]);

  // "Jak czytać panel" picked away from the overview: the tour's targets live
  // there, so start it once the overview has had a moment to stream in.
  useEffect(() => {
    if (!pendingTourRef.current || pathname !== base) return;
    pendingTourRef.current = false;
    const t = setTimeout(() => window.dispatchEvent(new Event(PALETTE_EVENTS.tour)), 900);
    return () => clearTimeout(t);
  }, [pathname, base]);

  // Lock page scroll behind the overlay.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const navigate = useCallback(
    (href: string) => {
      // Keep the demo's language switch when hopping between tabs.
      const lang = new URLSearchParams(window.location.search).get("lang");
      const target = lang ? `${href}?lang=${encodeURIComponent(lang)}` : href;
      startTransition(() => router.push(target));
    },
    [router]
  );

  const commands = useMemo<Command[]>(() => {
    const tab = pathname.split("/")[2] ?? "";

    const tabs: Array<{ path: string; label: string; icon: Icon; keywords?: string }> = [
      { path: "", label: "Przegląd", icon: LayoutDashboard, keywords: "overview start home kpi podsumowanie wyniki budzet cele rekordy wydatki ile wydalismy" },
      ...(isSeasonal
        ? [{ path: "sezon", label: "Sezon", icon: CalendarRange, keywords: "season sezonowy swieta boze narodzenie wigilia mikolajki black friday poprzedni sezon porownanie rok do roku prognoza" }]
        : []),
      ...(isEcommerce
        ? [{ path: "sprzedaz", label: "Sprzedaż", icon: ShoppingBag, keywords: "sales sklep zamowienia przychod" }]
        : []),
      { path: "reklamy", label: "Reklamy", icon: Megaphone, keywords: "ads kampanie meta google facebook instagram koszt klikniecia cpc klikalnosc ctr wydatki frazy wyszukiwania" },
      { path: "kreacje", label: "Kreacje", icon: ImageIcon, keywords: "creatives grafiki wideo filmy obrazki najlepsze reklamy" },
      { path: "witryna", label: "Witryna", icon: Globe, keywords: "strona website ga4 ruch sesje wizyty odwiedziny telefon urzadzenia zrodla odbiorcy wiek" },
      { path: "alerty", label: "Alerty", icon: BellRing, keywords: "alerts powiadomienia problemy ostrzezenia pilne anomalie" },
      { path: "raport", label: "Raport", icon: FileText, keywords: "report miesieczny" },
      { path: "newsy", label: "Newsy", icon: Newspaper, keywords: "news aktualnosci" },
      { path: "slowniczek", label: "Słowniczek pojęć", icon: BookOpen, keywords: "slownik pojecia co to znaczy wyjasnienia ctr cpc roas pomoc glossary" },
      ...(isAgency
        ? [{ path: "settings", label: "Ustawienia", icon: Settings, keywords: "settings integracje konfiguracja" }]
        : []),
    ];

    const nav: Command[] = tabs
      .map((t) => ({ ...t, href: t.path ? `${base}/${t.path}` : base }))
      .filter((t) => !omit.includes(t.href))
      .map((t) => ({
        id: `nav:${t.path}`,
        group: "nav" as const,
        label: t.label,
        keywords: t.keywords,
        icon: t.icon,
        current: tab === t.path,
        run: () => navigate(t.href),
      }));

    const clientCmds: Command[] =
      isAgency && clients
        ? [
            {
              id: "clients:all",
              group: "clients",
              label: "Wszyscy klienci",
              keywords: "lista clients",
              icon: LayoutGrid,
              current: pathname === "/clients",
              run: () => navigate("/clients"),
            },
            ...clients.map<Command>((c) => ({
              id: `client:${c.slug}`,
              group: "clients",
              label: c.name,
              keywords: c.slug,
              hint: c.slug === clientSlug ? undefined : "Ten sam widok",
              icon: Building2,
              current: c.slug === clientSlug,
              run: () => {
                const rest = pathname.split("/").slice(2).join("/");
                navigate(`/${c.slug}${rest ? `/${rest}` : ""}`);
              },
            })),
          ]
        : [];

    const rangeCmds: Command[] = RANGE_KEYS.map((key) => ({
      id: `range:${key}`,
      group: "range",
      label: RANGE_LABELS[key],
      keywords: `zakres daty okres ${key}`,
      icon: CalendarRange,
      current: currentRange === key,
      run: () => {
        const params = new URLSearchParams(window.location.search);
        params.set("range", key);
        params.delete("from");
        params.delete("to");
        const path = NO_RANGE_TABS.has(tab) ? base : pathname;
        rangePendingRef.current = true;
        startTransition(() => router.push(`${path}?${params.toString()}`, { scroll: false }));
      },
    }));

    const actions: Command[] = [
      {
        id: "action:present",
        group: "actions",
        label: "Prezentuj",
        keywords: "prezentacja tv rzutnik pelny ekran fullscreen present",
        icon: MonitorPlay,
        run: () => window.dispatchEvent(new Event(PALETTE_EVENTS.present)),
      },
      {
        id: "action:print",
        group: "actions",
        label: "Pobierz PDF",
        keywords: "drukuj print pdf eksport",
        icon: Printer,
        // Let React drop the overlay before the browser snapshots the page.
        run: () => setTimeout(() => window.print(), 80),
      },
      {
        id: "action:tour",
        group: "actions",
        label: "Jak czytać panel",
        keywords: "pomoc przewodnik samouczek help tour",
        icon: HelpCircle,
        run: () => {
          if (pathname === base) {
            window.dispatchEvent(new Event(PALETTE_EVENTS.tour));
          } else {
            pendingTourRef.current = true;
            navigate(base);
          }
        },
      },
      {
        id: "action:theme",
        group: "actions",
        label: "Przełącz motyw",
        keywords: "ciemny jasny dark light theme terminal tryb",
        hint: isDark ? "Na jasny" : "Na ciemny",
        icon: SunMoon,
        run: () => window.dispatchEvent(new Event(PALETTE_EVENTS.theme)),
      },
    ];

    return [...nav, ...clientCmds, ...rangeCmds, ...actions];
  }, [
    pathname,
    base,
    clientSlug,
    isAgency,
    isEcommerce,
    isSeasonal,
    clients,
    omit,
    currentRange,
    isDark,
    navigate,
    router,
  ]);

  const rows = useMemo<Row[]>(() => {
    const q = fold(query).trim().replace(/\s+/g, " ");
    const scored: Row[] = [];
    for (const command of commands) {
      const s = scoreCommand(q, command);
      if (s) scored.push({ key: command.id, group: command.group, command, score: s.score, match: s.match });
    }

    if (!q) {
      const byId = new Map(commands.map((c) => [c.id, c]));
      const recentRows: Row[] = recent
        .map((id) => byId.get(id))
        .filter((c): c is Command => Boolean(c))
        .map((command) => ({ key: `recent-${command.id}`, group: "recent", command, score: 1, match: null }));
      return [...recentRows, ...scored];
    }

    // Groups stay together (scannable), ordered by their best hit, so the
    // top row is always the strongest match.
    const best = new Map<GroupKey, number>();
    for (const r of scored) best.set(r.group, Math.max(best.get(r.group) ?? 0, r.score));
    return scored.sort((a, b) => {
      if (a.group !== b.group) {
        const diff = (best.get(b.group) ?? 0) - (best.get(a.group) ?? 0);
        return diff || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
      }
      return b.score - a.score;
    });
  }, [commands, query, recent]);

  // Keep the highlight on a real row as the list shrinks/grows.
  useEffect(() => {
    setActive((i) => (rows.length ? Math.min(i, rows.length - 1) : 0));
  }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    const row = rows[active];
    if (!row) return;
    document.getElementById(optionId(row.key))?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    // optionId is derived from a stable useId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, rows]);

  function runRow(row: Row | undefined) {
    if (!row) return;
    const cmd = row.command;
    pushRecent(cmd.id);
    // Presentation/print blur focus themselves; returning focus to a header
    // button they hide would make Space press it.
    const restore = cmd.id !== "action:present" && cmd.id !== "action:print";
    closePalette(restore);
    if (cmd.current && cmd.group !== "range") return;
    cmd.run();
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (rows.length) setActive((i) => (i + 1) % rows.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rows.length) setActive((i) => (i - 1 + rows.length) % rows.length);
        break;
      case "Home":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setActive(Math.max(0, rows.length - 1));
        }
        break;
      case "Enter":
        e.preventDefault();
        runRow(rows[active]);
        break;
      case "Escape":
        e.preventDefault();
        // Stop presentation mode's Esc handler from also ending the show.
        e.stopPropagation();
        if (query) setQuery("");
        else closePalette();
        break;
    }
  }

  // Focus trap: Tab cycles through the few focusables in the panel only.
  function onPanelKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && e.target !== inputRef.current) {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>("input, button:not([disabled])")
    ).filter((el) => el.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const activeRow = rows[active];
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  const overlay =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[70] print:hidden">
            <div
              aria-hidden
              onMouseDown={() => closePalette()}
              className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-in fade-in-0 duration-150 motion-reduce:animate-none"
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onKeyDown={onPanelKey}
              className={cn(
                "absolute inset-x-0 top-0 flex max-h-[85vh] flex-col overflow-hidden border-b border-hairline bg-card text-card-foreground shadow-raised",
                "rounded-b-card animate-in fade-in-0 slide-in-from-top-4 duration-150",
                "sm:inset-x-auto sm:left-1/2 sm:top-[15vh] sm:max-h-[70vh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-card sm:border sm:slide-in-from-top-2 sm:zoom-in-95",
                "motion-reduce:animate-none"
              )}
            >
              <h2 id={titleId} className="sr-only">
                Paleta poleceń
              </h2>
              <div className="flex items-center gap-2.5 border-b border-border px-4">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeRow ? optionId(activeRow.key) : undefined}
                  aria-label="Szukaj poleceń"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onInputKey}
                  placeholder="Szukaj zakładki, klienta, akcji…"
                  className="h-12 min-w-0 flex-1 border-0 bg-transparent p-0 text-base outline-none placeholder:text-muted-foreground focus:ring-0 sm:text-sm"
                />
                <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                  Esc
                </kbd>
                <button
                  type="button"
                  onClick={() => closePalette()}
                  className="rounded-full px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
                >
                  Anuluj
                </button>
              </div>

              <div
                id={listId}
                role="listbox"
                aria-label="Wyniki"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
              >
                {rows.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">
                    Brak wyników dla „{query}”
                  </p>
                ) : (
                  GROUP_ORDER.filter((g) => rows.some((r) => r.group === g))
                    .sort(
                      (a, b) =>
                        rows.findIndex((r) => r.group === a) - rows.findIndex((r) => r.group === b)
                    )
                    .map((group) => {
                      const headingId = `${uid}-group-${group}`;
                      return (
                        <div key={group} role="group" aria-labelledby={headingId} className="pb-1">
                          <div
                            id={headingId}
                            role="presentation"
                            className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80"
                          >
                            {GROUP_LABELS[group]}
                          </div>
                          {rows.map((row, i) => {
                            if (row.group !== group) return null;
                            const cmd = row.command;
                            const Icon = row.group === "recent" ? History : cmd.icon;
                            const selected = i === active;
                            return (
                              <div
                                  key={row.key}
                                  id={optionId(row.key)}
                                  role="option"
                                  aria-selected={selected}
                                  aria-current={cmd.current ? "true" : undefined}
                                  onPointerMove={() => {
                                    if (!selected) setActive(i);
                                  }}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => runRow(row)}
                                  className={cn(
                                    "flex cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 text-sm",
                                    // v2 "selected" = the anchor pill. surface-anchor
                                    // re-points the muted tokens so the row's
                                    // secondary text stays readable on it.
                                    selected ? "surface-anchor bg-card text-card-foreground" : "text-foreground"
                                  )}
                                >
                                  <Icon
                                    className={cn(
                                      "h-4 w-4 shrink-0",
                                      selected ? "text-card-foreground" : "text-muted-foreground"
                                    )}
                                    aria-hidden
                                  />
                                  <span className="min-w-0 flex-1 truncate">
                                    <Highlight text={cmd.label} match={row.match} />
                                  </span>
                                  {row.group === "recent" ? (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {GROUP_LABELS[cmd.group]}
                                    </span>
                                  ) : null}
                                  {cmd.current ? (
                                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                      <Check className="h-3.5 w-3.5" aria-hidden />
                                      {cmd.group === "range" ? "Aktywny" : "Tu jesteś"}
                                    </span>
                                  ) : cmd.hint && row.group !== "recent" ? (
                                    <span className="shrink-0 text-xs text-muted-foreground">{cmd.hint}</span>
                                  ) : null}
                                  {selected ? (
                                    <CornerDownLeft
                                      className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
                                      aria-hidden
                                    />
                                  ) : null}
                                </div>
                            );
                          })}
                        </div>
                      );
                    })
                )}
              </div>

              <div className="hidden items-center gap-4 border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground sm:flex">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-card px-1 font-mono">↑</kbd>
                  <kbd className="rounded border border-border bg-card px-1 font-mono">↓</kbd>
                  wybierz
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-card px-1 font-mono">↵</kbd>
                  otwórz
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-card px-1 font-mono">Esc</kbd>
                  zamknij
                </span>
                <span className="ml-auto">
                  <kbd className="rounded border border-border bg-card px-1 font-mono">{shortcut}</kbd>
                </span>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => (open ? closePalette() : openPalette())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K /"
        aria-label="Szukaj (paleta poleceń)"
        title={`Szukaj (${shortcut})`}
        className="gap-2 text-muted-foreground sm:w-44 sm:justify-start"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden flex-1 text-left font-normal sm:inline">Szukaj…</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-foreground/70 sm:inline">
          {shortcut}
        </kbd>
      </Button>
      {overlay}
    </>
  );
}
