import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { AlertsFilter } from "@/components/dashboard/alerts-filter";
import { Ping, StatusChip, type PingTone } from "@/components/ui/primitives";
import type { Anomaly } from "@/lib/alerts/anomalies";
import { plPlural } from "@/lib/dashboard/story";
import { cn } from "@/lib/utils";

// Presentation layer for alerts on the Alerty pages (real + demo). The alert
// objects from lib/alerts speak agency jargon ("Skok CPC +45%", "baza") because
// they also feed e-mail/Telegram notifications for us. A marketing manager
// reading this before a board meeting needs three things instead: what
// happened, why it matters, and what the agency is doing about it.

type Lang = "pl" | "en";
type Severity = Anomaly["severity"];

// Same words and colours as the overview digest (alerts-digest.tsx), so an
// alert looks identical wherever the client meets it.
export const SEVERITY_LABEL: Record<Lang, Record<Severity, string>> = {
  pl: { critical: "Pilne", high: "Ważne", medium: "Informacja" },
  en: { critical: "Urgent", high: "Important", medium: "FYI" },
};

// v2: a small dot with a soft halo (same as campaign status dots on the
// overview). Red = act now, amber = soon, grey = FYI - the label always
// carries the meaning too.
export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-negative ring-negative-soft",
  high: "bg-warning-fill ring-warning-soft",
  medium: "bg-chart-muted ring-muted",
};

const SECTION_HINT: Record<Lang, Record<Severity, string>> = {
  pl: {
    critical: "Sprawdzamy w pierwszej kolejności",
    high: "Zajmujemy się tym w najbliższych dniach",
    medium: "Do wiadomości - obserwujemy",
  },
  en: {
    critical: "We're checking this today",
    high: "We'll handle this in the next few days",
    medium: "For your information - we're watching",
  },
};

type Kind =
  | "spend_spike"
  | "spend_week"
  | "spend_up"
  | "spend_down"
  | "cpc_up"
  | "cpc_down"
  | "ctr_up"
  | "ctr_down"
  | "clicks_up"
  | "clicks_down"
  | "sessions_up"
  | "sessions_down"
  | "orders_zero"
  | "shop_conversion_down"
  | "revenue_down"
  | "other";

// Metric names differ between live alerts ("Wydatki", "Sesje") and the demo
// data ("spend", "sessions"), so match loosely on both.
function kindOf(a: Anomaly): Kind {
  const m = a.metric.toLowerCase();
  const up = a.direction === "up";
  if (m.includes("wydatk") || m.includes("spend")) {
    if (m.includes("7") || /7\s*(dni|days)/i.test(a.title) || a.id.endsWith("-week")) {
      return "spend_week";
    }
    if (a.severity === "critical") return "spend_spike";
    return up ? "spend_up" : "spend_down";
  }
  if (m.includes("cpc")) return up ? "cpc_up" : "cpc_down";
  if (m.includes("ctr")) return up ? "ctr_up" : "ctr_down";
  if (m.includes("klik") || m.includes("click")) return up ? "clicks_up" : "clicks_down";
  if (m.includes("sesj") || m.includes("session")) return up ? "sessions_up" : "sessions_down";
  if (m.includes("zamówie") || m.includes("order")) return "orders_zero";
  if (m.includes("konwersj") || m.includes("conversion")) return "shop_conversion_down";
  if (m.includes("przych") || m.includes("revenue")) return "revenue_down";
  return "other";
}

/** Movements that are good news - shown with a green arrow, not a red one. */
const GOOD_NEWS: ReadonlySet<Kind> = new Set<Kind>([
  "cpc_down",
  "ctr_up",
  "clicks_up",
  "sessions_up",
]);

interface Explained {
  headline: string;
  happened: string;
  why: string;
  action: string;
}

// Emoji in notification titles help in Telegram but look noisy on a board
// slide; the severity pill already carries the urgency.
function stripEmoji(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

// Light de-jargoning of the generated Polish descriptions - they carry the
// concrete numbers, which are worth keeping.
function plainDescription(s: string): string {
  return s
    .replace(/^CPC wzrósł do/, "Koszt kliknięcia wzrósł do")
    .replace(/^CTR spadł do/, "Klikalność spadła do")
    .replace(/\(baza: /g, "(zwykle: ")
    .replace(/sesje w GA4/g, "wizyty na stronie");
}

function pctText(n: number, lang: Lang): string {
  return `${Math.round(Math.abs(n)).toLocaleString(lang === "en" ? "en-GB" : "pl-PL")}%`;
}

function scopeText(a: Anomaly, lang: Lang): string {
  if (a.scope === "campaign") {
    return lang === "en" ? `Campaign „${a.scopeLabel}”` : `Kampania „${a.scopeLabel}”`;
  }
  return a.scopeLabel;
}

export function explainAlert(a: Anomaly, lang: Lang = "pl"): Explained {
  const en = lang === "en";
  const p = pctText(a.changePct, lang);
  const happened = en ? a.description : plainDescription(a.description);
  const kind = kindOf(a);

  const copy: Record<Kind, { pl: [string, string, string]; en: [string, string, string] }> = {
    spend_spike: {
      pl: [
        stripEmoji(a.title),
        "Jeśli to nie jest zaplanowany wzrost, budżet może skończyć się szybciej, niż zakładaliśmy.",
        "Sprawdzamy, czy to celowe (np. promocja). Jeśli nie - proponujemy korektę budżetu kampanii.",
      ],
      en: [
        stripEmoji(a.title),
        "Unless this increase was planned, the budget may run out sooner than expected.",
        "We check right away whether it's intentional (e.g. a promotion). If not, we cap the campaign budget today.",
      ],
    },
    spend_week: {
      pl: [
        stripEmoji(a.title),
        "W takim tempie budżet na miesiąc może skończyć się przed jego końcem.",
        "Sprawdzamy, czy większe wydatki dają też więcej kliknięć i wizyt. Jeśli nie - proponujemy powrót do wcześniejszego poziomu.",
      ],
      en: [
        stripEmoji(a.title),
        "At this pace the monthly budget may run out before the month ends.",
        "We check whether the extra spend brings more clicks and visits. If not, we go back to the previous level.",
      ],
    },
    spend_up: {
      pl: [
        `Wydajemy wyraźnie więcej niż zwykle (o ${p})`,
        "W takim tempie budżet na miesiąc może skończyć się przed jego końcem.",
        "Sprawdzamy, czy wzrost był zaplanowany i czy daje więcej kliknięć oraz wizyt.",
      ],
      en: [
        `We're spending clearly more than usual (${p} more)`,
        "At this pace the monthly budget may run out before the month ends.",
        "We check whether the increase was planned and whether it brings more clicks and visits.",
      ],
    },
    spend_down: {
      pl: [
        `Wydajemy wyraźnie mniej niż zwykle (o ${p})`,
        "Mniejsze wydatki zwykle oznaczają, że mniej osób widzi reklamy i trafia na stronę.",
        "Sprawdzamy, czy to nie problem z płatnością, odrzucone reklamy albo wyczerpany budżet kampanii.",
      ],
      en: [
        `We're spending clearly less than usual (${p} less)`,
        "Lower spend usually means fewer people see the ads and reach the website.",
        "We check for payment issues, rejected ads or a campaign budget that ran out.",
      ],
    },
    cpc_up: {
      pl: [
        `Kliknięcie w reklamę zdrożało o ${p}`,
        "Za ten sam budżet dostajemy mniej kliknięć - czyli mniej osób trafia na stronę.",
        "Sprawdzamy, czy rośnie konkurencja albo czy reklama się „opatrzyła”. W razie potrzeby proponujemy zmianę stawek lub odświeżenie reklam.",
      ],
      en: [
        `An ad click got ${p} more expensive`,
        "The same budget buys fewer clicks - so fewer people reach the website.",
        "We check whether competition went up or the ad has gone stale, and adjust bids or creatives if needed.",
      ],
    },
    cpc_down: {
      pl: [
        `Kliknięcie w reklamę potaniało o ${p}`,
        "Za ten sam budżet dostajemy więcej kliknięć - to dobra wiadomość.",
        "Pilnujemy, żeby tańsze kliknięcia nadal przyprowadzały zainteresowane osoby.",
      ],
      en: [
        `An ad click got ${p} cheaper`,
        "The same budget buys more clicks - good news.",
        "We make sure the cheaper clicks still bring interested people.",
      ],
    },
    ctr_up: {
      pl: [
        `Więcej osób klika w reklamy (o ${p})`,
        "Reklamy lepiej trafiają do odbiorców - za te same pieniądze mamy więcej kliknięć.",
        "Sprawdzamy, co działa najlepiej, żeby wykorzystać to w kolejnych kampaniach.",
      ],
      en: [
        `More people are clicking the ads (${p} up)`,
        "The ads resonate better - the same money buys more clicks.",
        "We look at what works best and roll it out to the other campaigns.",
      ],
    },
    ctr_down: {
      pl: [
        `Mniej osób klika w reklamy (o ${p})`,
        "Reklama słabiej przyciąga uwagę - często to znak, że ludzie widzieli ją już zbyt wiele razy.",
        "Sprawdzamy, komu reklama się wyświetla, i w razie potrzeby proponujemy odświeżenie grafik lub tekstów.",
      ],
      en: [
        `Fewer people are clicking the ads (${p} down)`,
        "The ad grabs less attention - often a sign people have seen it too many times.",
        "We prepare fresh visuals or copy and check who the ad is being shown to.",
      ],
    },
    clicks_up: {
      pl: [
        `Więcej kliknięć w reklamy (o ${p})`,
        "Więcej osób trafia z reklam na stronę.",
        "Obserwujemy, czy wzrost się utrzymuje i nie podnosi kosztów.",
      ],
      en: [
        `More ad clicks (${p} up)`,
        "More people reach the website from the ads.",
        "We watch whether the growth holds without pushing costs up.",
      ],
    },
    clicks_down: {
      pl: [
        `Mniej kliknięć w reklamy (o ${p})`,
        "Mniej kliknięć to mniej osób, które trafiają z reklam na stronę.",
        "Sprawdzamy, czy reklamy wyświetlają się normalnie, nie zostały wstrzymane i nie skończył się ich budżet.",
      ],
      en: [
        `Fewer ad clicks (${p} down)`,
        "Fewer clicks means fewer people reaching the website from the ads.",
        "We check that the ads are running normally, haven't been paused and haven't run out of budget.",
      ],
    },
    sessions_up: {
      pl: [
        `Więcej wizyt na stronie (o ${p})`,
        "Więcej osób ogląda ofertę.",
        "Sprawdzamy, skąd przychodzi dodatkowy ruch, żeby go utrzymać.",
      ],
      en: [
        `More website visits (${p} up)`,
        "More people are looking at the offer.",
        "We check where the extra traffic comes from so we can keep it.",
      ],
    },
    sessions_down: {
      pl: [
        `Mniej wizyt na stronie (o ${p})`,
        "Mniej osób ogląda ofertę - to może przełożyć się na mniej zapytań.",
        "Sprawdzamy, czy strona działa i czy pomiar (Google Analytics) zbiera dane, a potem, z którego źródła ubyło ruchu.",
      ],
      en: [
        `Fewer website visits (${p} down)`,
        "Fewer people see the offer - this can mean fewer enquiries.",
        "We check that the site works and analytics is collecting data, then which source lost traffic.",
      ],
    },
    orders_zero: {
      pl: [
        stripEmoji(a.title),
        "Ludzie wchodzą na stronę, ale nikt nie kupuje - to często oznacza problem z koszykiem lub płatnościami.",
        "Od razu sprawdzamy, czy da się złożyć zamówienie i czy sprzedaż jest poprawnie mierzona.",
      ],
      en: [
        stripEmoji(a.title),
        "People visit but nobody buys - often a sign of a checkout or payment problem.",
        "We immediately test placing an order and check that sales are being tracked.",
      ],
    },
    shop_conversion_down: {
      pl: [
        `Mniej odwiedzających składa zamówienie (o ${p})`,
        "Z tego samego ruchu jest mniej sprzedaży.",
        "Sprawdzamy proces zakupu, ceny i dostępność produktów.",
      ],
      en: [
        `Fewer visitors place an order (${p} down)`,
        "The same traffic brings fewer sales.",
        "We check the checkout, prices and product availability.",
      ],
    },
    revenue_down: {
      pl: [
        `Spadek sprzedaży (o ${p})`,
        "Sklep sprzedaje mniej, choć wydatki na reklamy są podobne.",
        "Sprawdzamy, czy to efekt mniejszego ruchu, czy mniejszej liczby zamówień.",
      ],
      en: [
        `Sales are down (${p})`,
        "The shop earns less for similar ad spend.",
        "We check whether it's less traffic or fewer orders.",
      ],
    },
    other: {
      pl: [
        stripEmoji(a.title),
        "Wynik odbiega od tego, co zwykle widzimy na koncie.",
        "Przyglądamy się temu i damy znać, jeśli trzeba będzie coś zmienić.",
      ],
      en: [
        stripEmoji(a.title),
        "The result differs from what we usually see on the account.",
        "We're looking into it and will let you know if anything needs to change.",
      ],
    },
  };

  const [headline, why, action] = copy[kind][en ? "en" : "pl"];
  return { headline, happened, why, action };
}

// 2026 pastel: severity = an icon tile (coral triangle / amber clock / grey
// info) + the group's ping dot + words. Good news trades the severity icon
// for a lime arrow so a "more clicks" note never reads like a problem.
const SEVERITY_TILE: Record<Severity, { icon: LucideIcon; tile: string }> = {
  critical: { icon: TriangleAlert, tile: "bg-negative-soft text-negative" },
  high: { icon: Clock, tile: "bg-warning-soft text-warning" },
  medium: { icon: Info, tile: "bg-chip text-ink-2" },
};

const SEVERITY_PING: Record<Severity, PingTone> = {
  critical: "coral",
  high: "amber",
  medium: "muted",
};

// Demo (and some live) scope labels end in the platform: "PMAX | Ruch ·
// Google". Lift it into a tag, like the board's "Google" / "Meta" chips.
const PLATFORM_SUFFIX = /\s·\s(Google|Meta|TikTok|GA4)$/;

function whereOf(a: Anomaly, lang: Lang): { tag: string | null; where: string } {
  const m = PLATFORM_SUFFIX.exec(a.scopeLabel);
  const label = m ? a.scopeLabel.slice(0, m.index) : a.scopeLabel;
  if (a.scope === "campaign") {
    return { tag: m ? m[1] : lang === "en" ? "Campaign" : "Kampania", where: label };
  }
  return { tag: m ? m[1] : null, where: label };
}

/**
 * One alert as its own glass card (Alerty board `.alc`): severity tile,
 * where (platform tag + campaign), the plain-language headline and the one
 * sentence of what happened. "Why it matters" / "what we're doing" sit
 * behind a native <details> - the chip button top right on sm+ - so the
 * list scans in seconds, works without client JS and prints open.
 */
export function AlertCard({
  a,
  lang = "pl",
  defaultOpen = false,
  index = 0,
}: {
  a: Anomaly;
  lang?: Lang;
  /** The board opens the first (most urgent) alert. */
  defaultOpen?: boolean;
  /** Entrance stagger. */
  index?: number;
}) {
  const en = lang === "en";
  const x = explainAlert(a, lang);
  const good = GOOD_NEWS.has(kindOf(a));
  const { tag, where } = whereOf(a, lang);
  const sev = SEVERITY_TILE[a.severity];
  const Icon = good ? (a.direction === "up" ? ArrowUpRight : ArrowDownRight) : sev.icon;

  return (
    <article
      className="glass relative rounded-[26px] p-5 animate-rise sm:p-6"
      style={{ "--d": `${0.15 + Math.min(index, 6) * 0.06}s` } as React.CSSProperties}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-[14px] [&_svg]:h-[18px] [&_svg]:w-[18px]",
            good ? "bg-lime-soft text-positive" : sev.tile
          )}
        >
          <Icon strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 sm:pr-36">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
            {tag ? (
              <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-chip px-2 text-xs font-semibold text-ink-2">
                {tag}
              </span>
            ) : null}
            <span className="min-w-0 truncate" title={a.scopeLabel}>
              {where}
            </span>
            {good ? (
              <span className="text-positive">· {en ? "good news" : "dobra wiadomość"}</span>
            ) : null}
          </p>
          <h3 className="mt-1.5 break-words text-[17px] font-semibold leading-snug tracking-[-0.01em]">
            {x.headline}
          </h3>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2 tabular-nums [text-wrap:pretty]">
            {x.happened}
          </p>
        </div>
      </div>

      <details className="group" data-print-open open={defaultOpen || undefined}>
        <summary className="ml-14 mt-3 inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full bg-chip px-4 text-sm font-medium text-foreground outline-none transition-colors hover:bg-[var(--chip-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:absolute sm:right-6 sm:top-6 sm:m-0 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{en ? "More" : "Więcej"}</span>
          <span className="hidden group-open:inline">{en ? "Less" : "Zwiń"}</span>
          <ChevronDown
            className="h-4 w-4 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 sm:pl-14">
          <div className="rounded-[18px] bg-chip px-4 py-3.5">
            <dt className="kick text-[11px]">{en ? "Why it matters" : "Dlaczego to ważne"}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed">{x.why}</dd>
          </div>
          <div className="rounded-[18px] bg-chip px-4 py-3.5">
            <dt className="kick text-[11px]">{en ? "What we're doing" : "Co z tym robimy"}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed">{x.action}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

/** "2 sprawy pilne i 1 ważna" - the one line a manager reads first. */
export function alertsHeadline(alerts: Anomaly[], lang: Lang = "pl"): string {
  const count = (s: Severity) => alerts.filter((a) => a.severity === s).length;
  const c = count("critical");
  const h = count("high");
  const m = count("medium");
  if (lang === "en") {
    const parts = [
      c ? `${c} urgent` : null,
      h ? `${h} important` : null,
      m ? `${m} for your information` : null,
    ].filter(Boolean);
    return `${alerts.length} ${alerts.length === 1 ? "thing" : "things"} to know: ${parts.join(", ")}.`;
  }
  const parts = [
    c ? `${c} ${plPlural(c, "pilna", "pilne", "pilnych")}` : null,
    h ? `${h} ${plPlural(h, "ważna", "ważne", "ważnych")}` : null,
    m ? `${m} do wiadomości` : null,
  ].filter(Boolean);
  return `${alerts.length} ${plPlural(alerts.length, "sprawa", "sprawy", "spraw")}: ${parts.join(", ")}.`;
}

const ORDER: Severity[] = ["critical", "high", "medium"];

/** One severity group: mono kicker with its ping dot + count, then cards. */
function AlertGroup({
  severity,
  alerts,
  lang,
  openFirst,
  offset,
}: {
  severity: Severity;
  alerts: Anomaly[];
  lang: Lang;
  openFirst: boolean;
  offset: number;
}) {
  return (
    <section aria-labelledby={`alerts-${severity}`}>
      <h2
        id={`alerts-${severity}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 animate-rise"
        style={{ "--d": `${0.1 + offset * 0.06}s` } as React.CSSProperties}
      >
        <span className="kick flex items-center gap-2.5 text-ink-2">
          <Ping tone={SEVERITY_PING[severity]} still={severity !== "critical"} />
          {SEVERITY_LABEL[lang][severity]}
          <span className="tabular-nums text-ink-3">· {alerts.length}</span>
        </span>
        <span className="text-sm text-ink-3">{SECTION_HINT[lang][severity]}</span>
      </h2>
      <div className="mt-3.5 space-y-3">
        {alerts.map((a, i) => (
          <AlertCard
            key={a.id}
            a={a}
            lang={lang}
            defaultOpen={openFirst && i === 0}
            index={offset + i}
          />
        ))}
      </div>
    </section>
  );
}

/** All alerts grouped Pilne -> Ważne -> Informacja, most urgent first. */
export function AlertGroups({ alerts, lang = "pl" }: { alerts: Anomaly[]; lang?: Lang }) {
  let offset = 0;
  return (
    <div className="space-y-8">
      {ORDER.map((s) => {
        const items = alerts.filter((a) => a.severity === s);
        if (items.length === 0) return null;
        const node = (
          <AlertGroup key={s} severity={s} alerts={items} lang={lang} openFirst={offset === 0} offset={offset} />
        );
        offset += items.length;
        return node;
      })}
    </div>
  );
}

/** Nothing to report: say so plainly and say we're still watching. */
export function AlertsAllClear({ lang = "pl" }: { lang?: Lang }) {
  const en = lang === "en";
  return (
    <section className="glass flex flex-col items-center gap-3.5 rounded-glass px-7 py-16 text-center animate-rise [--d:.2s] sm:py-[72px]">
      <span
        aria-hidden
        className="grid h-[72px] w-[72px] place-items-center rounded-full bg-lime-soft text-positive"
      >
        <Check className="h-8 w-8" strokeWidth={2.2} />
      </span>
      <h2 className="mt-1 text-[26px] font-medium tracking-[-0.03em]">
        {en ? "All good" : "Wszystko w porządku"}
      </h2>
      <p className="max-w-[26rem] text-[15px] leading-relaxed text-ink-2 [text-wrap:pretty]">
        {en
          ? "Nothing needs your attention. We check the campaigns every day - if anything changes, you'll see it here and on the bell."
          : "Nie ma nic, co wymagałoby Twojej uwagi. Pilnujemy kampanii codziennie - jeśli coś się zmieni, zobaczysz to tutaj i przy dzwonku."}
      </p>
    </section>
  );
}

/**
 * The whole Alerty board for the real and the demo page: header (kicker +
 * summary chip, title, lead, severity filter) and the groups - or the calm
 * all-clear card. Rendered as a fragment of top-level page children (one
 * presentation slide each).
 */
export function AlertsBoard({ alerts, lang = "pl" }: { alerts: Anomaly[]; lang?: Lang }) {
  const en = lang === "en";
  const urgent = alerts.some((a) => a.severity === "critical");
  const attention = alerts.some((a) => a.severity === "high");
  const tone: PingTone = urgent ? "coral" : attention ? "amber" : "live";

  const header = (
    <header className="min-w-0 max-w-2xl pt-2 md:pt-6">
      <div className="flex flex-wrap items-center gap-3 animate-rise [--d:.05s]">
        <span className="kick">{en ? "Checked every day" : "Sprawdzamy codziennie"}</span>
        <StatusChip tone={tone}>
          {alerts.length === 0
            ? en
              ? "All clear"
              : "Wszystko w normie"
            : alertsHeadline(alerts, lang).replace(/\.$/, "")}
        </StatusChip>
      </div>
      <h1 className="mt-5 text-[2.75rem] font-light leading-[0.95] tracking-[-0.05em] animate-rise [--d:.12s] sm:text-[3.75rem]">
        {en ? "Alerts" : "Alerty"}
      </h1>
      <p className="mt-3 text-balance text-[1.125rem] leading-snug tracking-[-0.02em] text-ink-3 animate-rise [--d:.2s] sm:text-[1.375rem]">
        {en
          ? "What needs attention - and what we're already doing about it."
          : "Co wymaga uwagi - i co już z tym robimy."}
      </p>
    </header>
  );

  if (alerts.length === 0) {
    return (
      <>
        {header}
        <AlertsAllClear lang={lang} />
      </>
    );
  }

  let offset = 0;
  const groups = ORDER.flatMap((s) => {
    const items = alerts.filter((a) => a.severity === s);
    if (items.length === 0) return [];
    const node = (
      <AlertGroup severity={s} alerts={items} lang={lang} openFirst={offset === 0} offset={offset} />
    );
    offset += items.length;
    return [{ key: s, label: SEVERITY_LABEL[lang][s], count: items.length, node }];
  });

  return (
    <AlertsFilter
      header={header}
      groups={groups}
      allLabel={en ? "All" : "Wszystkie"}
      ariaLabel={en ? "Filter by urgency" : "Filtruj według ważności"}
    />
  );
}
