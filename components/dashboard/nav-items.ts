import {
  BellRing,
  BookOpen,
  CalendarRange,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  Newspaper,
  Settings,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the phone tab bar. */
  short?: string;
  icon: LucideIcon;
  /**
   * Sub-pages that belong to this place (Kreacje inside Reklamy). The
   * sidebar reveals them only while you are in that place, so the resting
   * menu stays at four items.
   */
  children?: NavItem[];
};

export type NavGroup = {
  id: "main" | "more" | "agency";
  /** Visible group heading; the main group has none. */
  label?: string;
  items: NavItem[];
};

/** Fired by "Jak czytać panel" in the menus; HeaderMenu starts the tour. */
export const HELP_EVENT = "pato:help";

/**
 * Single source of truth for the dashboard navigation (2026: the top bar's
 * section pill via topNavItems(), the "…" menu, the phone tab bar + its
 * "Więcej" sheet, the phone header's page name, the command palette).
 *
 *   engagement client: Przegląd · Reklamy · Strona www · Raporty · Więcej
 *   e-commerce client: Przegląd · Sprzedaż · Reklamy · Strona www · Więcej
 *                      (Raporty moves into Więcej)
 *   seasonal client:   Sezon right after Przegląd; the phone tab bar keeps
 *                      its first four, so the last main place drops into
 *                      the "Więcej" sheet (mobile-nav.tsx)
 *
 * Kreacje lives inside Reklamy; Alerty, Newsy and Słowniczek are under
 * "Więcej" (alerts are also one tap away via the header bell); agency tools
 * are a separate group at the bottom. Routes are unchanged.
 */
export function buildNav({
  base,
  isEcommerce,
  isSeasonal = false,
  isAgency,
  omit = [],
}: {
  base: string;
  isEcommerce: boolean;
  /** clients.season is set (lib/season): adds the Sezon view. */
  isSeasonal?: boolean;
  isAgency: boolean;
  omit?: string[];
}): NavGroup[] {
  const keep = (i: NavItem) => !omit.includes(i.href);

  const reports: NavItem = { href: `${base}/raport`, label: "Raporty", icon: FileText };

  const main: NavItem[] = [
    { href: base, label: "Przegląd", icon: LayoutDashboard },
    // Second on purpose: in season it is the page a seasonal client opens
    // first, so it must keep a phone tab slot over the pages after it.
    ...(isSeasonal ? [{ href: `${base}/sezon`, label: "Sezon", icon: CalendarRange }] : []),
    ...(isEcommerce ? [{ href: `${base}/sprzedaz`, label: "Sprzedaż", icon: ShoppingBag }] : []),
    {
      href: `${base}/reklamy`,
      label: "Reklamy",
      icon: Megaphone,
      children: [{ href: `${base}/kreacje`, label: "Kreacje", icon: ImageIcon }],
    },
    { href: `${base}/witryna`, label: "Strona www", short: "Strona", icon: Globe },
    ...(isEcommerce ? [] : [reports]),
  ];

  const more: NavItem[] = [
    ...(isEcommerce ? [reports] : []),
    { href: `${base}/alerty`, label: "Alerty", icon: BellRing },
    // Phase 2 merges agency activity into this feed and renames it "Co robimy".
    { href: `${base}/newsy`, label: "Newsy", icon: Newspaper },
    { href: `${base}/slowniczek`, label: "Słowniczek pojęć", short: "Słowniczek", icon: BookOpen },
  ];

  const agency: NavItem[] = isAgency
    ? [
        { href: `${base}/settings`, label: "Ustawienia", icon: Settings },
        { href: `/clients`, label: "Wszyscy klienci", icon: LayoutGrid },
      ]
    : [];

  const groups: NavGroup[] = [
    {
      id: "main",
      items: main
        .filter(keep)
        .map((i) => (i.children ? { ...i, children: i.children.filter(keep) } : i)),
    },
    { id: "more", label: "Więcej", items: more.filter(keep) },
    { id: "agency", label: "Agencja", items: agency.filter(keep) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Every item, children flattened after their parent. */
export function flattenNav(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));
}

/**
 * The item the current path belongs to. Exact match first, then the deepest
 * prefix (settings/digest-preview -> Ustawienia). The overview only matches
 * exactly, otherwise it would claim every page.
 */
export function findActive(groups: NavGroup[], pathname: string, base: string): NavItem | undefined {
  const all = flattenNav(groups);
  const exact = all.find((i) => i.href === pathname);
  if (exact) return exact;
  return all
    .filter((i) => i.href !== base && pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** The top-level place an item belongs to (Kreacje -> Reklamy). */
export function findSection(groups: NavGroup[], item: NavItem | undefined): NavItem | undefined {
  if (!item) return undefined;
  for (const g of groups) {
    for (const i of g.items) {
      if (i.href === item.href || i.children?.some((c) => c.href === item.href)) return i;
    }
  }
  return undefined;
}

/**
 * The 2026 top bar's sections (Przeglad-pastel): Przegląd · [Sezon] ·
 * [Sprzedaż] · Reklamy · Strona · Alerty. Raporty, Newsy and Słowniczek move into the
 * "…" menu; Kreacje stays a child of Reklamy (its tabs + active state).
 */
export function topNavItems(groups: NavGroup[]): NavItem[] {
  const main = groups.find((g) => g.id === "main")?.items ?? [];
  const more = groups.find((g) => g.id === "more")?.items ?? [];
  const alerts = more.find((i) => i.href.endsWith("/alerty"));
  return [...main.filter((i) => !i.href.endsWith("/raport")), ...(alerts ? [alerts] : [])];
}
