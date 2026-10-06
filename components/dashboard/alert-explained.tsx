import { ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronDown } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
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

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-red-600",
  high: "bg-amber-500",
  medium: "bg-sky-500",
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

/**
 * One alert as a calm list row: where, what (headline), and the one
 * sentence of what happened. "Why it matters" and "what we're doing" sit
 * behind a native <details> "Więcej", so the list scans in seconds and
 * works without client JS. The severity lives on the group heading.
 */
export function AlertCard({ a, lang = "pl" }: { a: Anomaly; lang?: Lang }) {
  const en = lang === "en";
  const x = explainAlert(a, lang);
  const good = GOOD_NEWS.has(kindOf(a));
  const Arrow = a.direction === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <article className="px-5 py-4 sm:px-6">
      <p className="truncate text-xs text-muted-foreground" title={a.scopeLabel}>
        {scopeText(a, lang)}
      </p>
      <h3 className="mt-1 flex items-start gap-2 text-[15px] font-semibold leading-snug">
        <Arrow
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            good ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          )}
          aria-hidden
        />
        <span className="min-w-0 break-words">{x.headline}</span>
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        {x.happened}
      </p>

      <details className="group mt-2" data-print-open>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{en ? "More" : "Więcej"}</span>
          <span className="hidden group-open:inline">{en ? "Less" : "Mniej"}</span>
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>
        <dl className="mt-3 space-y-3 text-sm leading-relaxed">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {en ? "Why it matters" : "Dlaczego to ważne"}
            </dt>
            <dd className="mt-0.5">{x.why}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {en ? "What we're doing" : "Co z tym robimy"}
            </dt>
            <dd className="mt-0.5">{x.action}</dd>
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

/** All alerts grouped Pilne -> Ważne -> Informacja, most urgent first:
 *  one quiet card per group, alerts as divided rows inside it. */
export function AlertGroups({ alerts, lang = "pl" }: { alerts: Anomaly[]; lang?: Lang }) {
  const order: Severity[] = ["critical", "high", "medium"];
  return (
    <div className="space-y-8">
      {order.map((s) => {
        const items = alerts.filter((a) => a.severity === s);
        if (items.length === 0) return null;
        return (
          <section key={s} aria-labelledby={`alerts-${s}`}>
            <h2 id={`alerts-${s}`} className="mb-3 flex flex-wrap items-baseline gap-x-2">
              <span className="flex items-center gap-2 text-[15px] font-semibold">
                <span className={cn("h-2 w-2 rounded-full", SEVERITY_DOT[s])} aria-hidden />
                {SEVERITY_LABEL[lang][s]}
                <Pill className="tabular-nums">{items.length}</Pill>
              </span>
              <span className="text-sm text-muted-foreground">{SECTION_HINT[lang][s]}</span>
            </h2>
            <Card className="divide-y divide-border overflow-hidden">
              {items.map((a) => (
                <AlertCard key={a.id} a={a} lang={lang} />
              ))}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

/** Nothing to report: say so plainly and say we're still watching. */
export function AlertsAllClear({ lang = "pl" }: { lang?: Lang }) {
  const en = lang === "en";
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden />
      </span>
      <p className="text-section-title">
        {en ? "All good - nothing needs your attention" : "Wszystko w porządku - nic nie wymaga Twojej uwagi"}
      </p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {en
          ? "We check the campaigns every day. If anything moves out of the ordinary, you'll see it here - and we'll already be on it."
          : "Codziennie sprawdzamy kampanie. Jeśli coś odbiegnie od normy, zobaczysz to tutaj - a my już będziemy się tym zajmować."}
      </p>
    </Card>
  );
}
