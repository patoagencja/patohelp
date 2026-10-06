import {
  BellRing,
  BookOpen,
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

/** Soft colour of the icon tile; each main section keeps its own. */
export type NavTone = "indigo" | "emerald" | "orange" | "pink" | "sky" | "neutral";

export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the phone tab bar. */
  short?: string;
  /** One plain line under the label (desktop sidebar only). */
  description?: string;
  icon: LucideIcon;
  tone: NavTone;
  /** Sub-pages listed under their parent (Kreacje lives under Reklamy). */
  children?: NavItem[];
};

export type NavGroup = {
  id: "main" | "more" | "agency";
  /** Visible group heading; the main group has none. */
  label?: string;
  items: NavItem[];
};

/**
 * Single source of truth for the dashboard navigation (desktop sidebar, demo
 * sidebar, phone tab bar, header page title). A first-time visitor should see
 * only the few places that answer "how are we doing": Przegląd, Sprzedaż
 * (shops), Reklamy (with Kreacje inside) and Strona internetowa. Everything
 * else sits under "Więcej"; agency tools are a separate group at the bottom.
 */
export function buildNav({
  base,
  isEcommerce,
  isAgency,
  omit = [],
}: {
  base: string;
  isEcommerce: boolean;
  isAgency: boolean;
  omit?: string[];
}): NavGroup[] {
  const keep = (i: NavItem) => !omit.includes(i.href);

  const main: NavItem[] = [
    {
      href: base,
      label: "Przegląd",
      description: "Najważniejsze w skrócie",
      icon: LayoutDashboard,
      tone: "indigo",
    },
    ...(isEcommerce
      ? [
          {
            href: `${base}/sprzedaz`,
            label: "Sprzedaż",
            description: "Zamówienia i przychód",
            icon: ShoppingBag,
            tone: "emerald" as const,
          },
        ]
      : []),
    {
      href: `${base}/reklamy`,
      label: "Reklamy",
      description: "Na co idą pieniądze",
      icon: Megaphone,
      tone: "orange",
      children: [
        {
          href: `${base}/kreacje`,
          label: "Kreacje",
          description: "Które reklamy działają",
          icon: ImageIcon,
          tone: "pink",
        },
      ],
    },
    {
      href: `${base}/witryna`,
      label: "Strona internetowa",
      short: "Strona",
      description: "Kto odwiedza stronę",
      icon: Globe,
      tone: "sky",
    },
  ];

  const more: NavItem[] = [
    { href: `${base}/alerty`, label: "Alerty", icon: BellRing, tone: "neutral" },
    { href: `${base}/raport`, label: "Raport", icon: FileText, tone: "neutral" },
    { href: `${base}/newsy`, label: "Newsy", icon: Newspaper, tone: "neutral" },
    { href: `${base}/slowniczek`, label: "Słowniczek pojęć", short: "Słowniczek", icon: BookOpen, tone: "neutral" },
  ];

  const agency: NavItem[] = isAgency
    ? [
        { href: `${base}/settings`, label: "Ustawienia", icon: Settings, tone: "neutral" },
        { href: `/clients`, label: "Wszyscy klienci", icon: LayoutGrid, tone: "neutral" },
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

/** Tile classes per tone: soft tint, tinted glyph (AA on its own tint). */
export const TONE_TILE: Record<NavTone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  orange: "bg-orange-500/10 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
  pink: "bg-pink-500/10 text-pink-600 dark:bg-pink-400/15 dark:text-pink-300",
  sky: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  neutral: "bg-foreground/[0.06] text-muted-foreground dark:bg-foreground/10",
};
