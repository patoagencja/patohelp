import Link from "next/link";
import { Wallet } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import type { SeasonBudget } from "@/lib/season/budget";
import { dayMonthLong } from "@/lib/season/config";
import { compactPln } from "@/lib/season/format";
import { marketLabel } from "@/lib/season/markets";
import { cn, formatPlnWhole } from "@/lib/utils";

import { SeasonTabs } from "./season-tabs";

/** "3.10" from "2026-10-03". */
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;
const WEEKDAY = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];

/** Over / under plan in words, with the tone the tiles use. */
function paceWords(pace: number | null): { text: string; tone: "good" | "bad" | "flat" } | null {
  if (pace === null) return null;
  const pct = Math.round(Math.abs(pace - 1) * 100);
  if (pct <= 5) return { text: "zgodnie z planem", tone: "good" };
  return pace > 1
    ? { text: `${pct}% ponad plan`, tone: pct > 15 ? "bad" : "flat" }
    : { text: `${pct}% poniżej planu`, tone: pct > 15 ? "bad" : "flat" };
}

/**
 * "Budżet sezonu": the agency's season budget spread along last season's
 * own spending curve, against what really went out - and what each day and
 * each market should take from here to land on the budget. Shared by the
 * real page and the demo.
 */
export function BudgetPageView({
  budget,
  seasonLabel,
  base,
  isAgency,
  settingsHref,
  eyebrowExtra,
}: {
  /** null = no budget set (or before the season). */
  budget: SeasonBudget | null;
  seasonLabel: string;
  /** "/elfi/sezon" - the season tabs' base. */
  base: string;
  isAgency: boolean;
  settingsHref?: string;
  eyebrowExtra?: string;
}) {
  const header = (lead: string) => (
    <div className="space-y-5">
      <SeasonTabs base={base} active="budzet" />
      <PageHeader
        eyebrow={<span className="kick">{`${seasonLabel} · budżet${eyebrowExtra ?? ""}`}</span>}
        title="Budżet sezonu"
        description={lead}
      />
    </div>
  );

  if (!budget) {
    return (
      <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
        {header("Plan wydatków na reklamy na cały sezon, rozłożony tak jak w zeszłym roku - z podglądem, ile wydawać każdego dnia.")}
        <EmptyState
          icon={Wallet}
          title={isAgency ? "Ustaw budżet sezonu" : "Budżet sezonu nie jest jeszcze ustawiony"}
          description={
            isAgency
              ? "Wpisz w ustawieniach klienta, ile łącznie chcecie wydać na reklamy w tym sezonie. Panel rozłoży to na dni według zeszłorocznego sezonu i rynki według ich udziału."
              : "Gdy agencja wpisze budżet, zobaczysz tu plan wydatków dzień po dniu i to, czy idziemy zgodnie z nim."
          }
          action={
            isAgency && settingsHref ? (
              <Button asChild size="pill">
                <Link href={settingsHref}>Ustaw budżet</Link>
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  const pace = paceWords(budget.pace);
  const lead =
    budget.pace === null
      ? `Budżet sezonu: ${compactPln(budget.total)}. Pierwsze porównanie z planem po pierwszym pełnym dniu sezonu.`
      : `Wydaliście ${compactPln(budget.spentToDate)} z ${compactPln(budget.total)} - ${
          pace?.text === "zgodnie z planem" ? "zgodnie z planem" : `${pace?.text} na ten moment`
        } (plan do wczoraj: ${compactPln(budget.planToDate)}).`;
  const projectedNote =
    budget.projected !== null && budget.pace !== null
      ? budget.projected > budget.total * 1.05
        ? `W tym tempie sezon zamknie się na ok. ${compactPln(budget.projected)} - ${compactPln(budget.projected - budget.total)} ponad budżet.`
        : budget.projected < budget.total * 0.95
          ? `W tym tempie zostanie ok. ${compactPln(budget.total - budget.projected)} niewydane.`
          : "W tym tempie sezon zamknie się na budżecie."
      : null;

  return (
    <div className="space-y-10 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      {header(lead)}

      <section aria-label="Budżet w liczbach" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          index={0}
          highlight
          label="Budżet sezonu"
          explain="Wszystkie kampanie reklamowe łącznie na cały sezon (netto)."
          value={formatPlnWhole(budget.total)}
          meter={budget.total > 0 ? Math.min(1, budget.spentToDate / budget.total) : null}
          sub={`zostało ${formatPlnWhole(budget.remaining)}`}
        />
        <StatTile
          index={1}
          label="Wydane do wczoraj"
          explain="Wydatki na reklamy od początku sezonu do wczoraj włącznie."
          value={formatPlnWhole(budget.spentToDate)}
          // Short in the corner (the long label needs the room); the words below.
          delta={
            budget.pace !== null && pace
              ? {
                  text: `${Math.round(Math.abs(budget.pace - 1) * 100)}%`,
                  tone: pace.tone,
                  direction: Math.round(Math.abs(budget.pace - 1) * 100) === 0 ? null : budget.pace > 1 ? "up" : "down",
                }
              : null
          }
          sub={`${pace ? `${pace.text} · ` : ""}plan do wczoraj: ${formatPlnWhole(budget.planToDate)}`}
        />
        <StatTile
          index={2}
          label="Dziś według planu"
          explain="Ile wydać dziś, żeby to, co zostało z budżetu, rozłożyło się na resztę sezonu tak jak w zeszłym roku."
          value={formatPlnWhole(budget.todayPlan)}
          sub={budget.todaySpend > 0 ? `dziś wydano już ${formatPlnWhole(budget.todaySpend)}` : undefined}
        />
        <StatTile
          index={3}
          label="Koniec sezonu w tym tempie"
          explain="Ile wyniosą wydatki na koniec sezonu, jeśli dalej będą szły tak jak dotąd na tle planu."
          value={budget.projected !== null ? formatPlnWhole(budget.projected) : "-"}
          sub={projectedNote ?? undefined}
        />
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Plan a wydatki"
          description={
            budget.curveSource === "prev"
              ? "Plan rośnie tak jak wydatki w zeszłym sezonie - szybciej w tygodniach Black Friday i Mikołajek, wolniej na starcie."
              : "Brak zeszłego sezonu w danych: plan jest rozłożony po równo na każdy dzień."
          }
        />
        <Card className="p-5 sm:p-6">
          <BudgetChart budget={budget} />
        </Card>
      </section>

      {budget.next.length ? (
        <section className="space-y-4">
          <SectionHeader
            title="Najbliższe dni"
            description="Ile wydawać dziennie, żeby z tego, co zostało, wyjść dokładnie na budżet."
          />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {budget.next.map((d, i) => (
              <li key={d.date} className={cn("glass rounded-[20px] p-4", i === 0 && "ring-1 ring-[hsl(var(--lime-line))]")}>
                <p className="kick text-[11px]">
                  {i === 0 ? "dziś" : weekday(d.date)} · {dm(d.date)}
                </p>
                <p className="mt-2 text-lg font-medium tabular-nums tracking-[-0.02em]">{formatPlnWhole(d.amount)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionHeader title="Tydzień po tygodniu" description="Plan każdego tygodnia i ile w nim wydano (w trwającym tygodniu - do wczoraj)." />
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[32rem] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="px-5 py-3 font-medium">Tydzień</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Plan</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Wydane</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Na tle planu</th>
              </tr>
            </thead>
            <tbody>
              {budget.weeks.map((w) => {
                const p = w.actual !== null && w.planSoFar > 0 ? paceWords(w.actual / w.planSoFar) : null;
                return (
                  <tr key={w.from} className={cn("border-t border-line", w.current && "bg-lime-soft/40")}>
                    <td className="px-5 py-3">
                      {dm(w.from)} - {dm(w.to)}
                      {w.current ? <span className="ml-2 text-xs text-ink-3">trwa</span> : null}
                    </td>
                    <td className="px-5 py-3 text-right">{formatPlnWhole(w.plan)}</td>
                    <td className="px-5 py-3 text-right">{w.actual !== null ? formatPlnWhole(w.actual) : "-"}</td>
                    <td
                      className={cn(
                        "px-5 py-3 text-right",
                        p?.tone === "bad" ? "text-negative" : p?.tone === "good" ? "text-positive" : "text-ink-2"
                      )}
                    >
                      {p?.text ?? "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      {budget.markets.length ? (
        <section className="space-y-4">
          <SectionHeader
            title="Budżet na rynki"
            description="Podział według zeszłego sezonu: każdy rynek dostaje taki udział, jaki miał w wydatkach, i rozkłada go według własnego kalendarza."
          />
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[40rem] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th scope="col" className="px-5 py-3 font-medium">Rynek</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Budżet</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Wydane</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Na tle planu</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Dziś według planu</th>
                </tr>
              </thead>
              <tbody>
                {budget.markets.map((m) => {
                  const p = paceWords(m.pace);
                  return (
                    <tr key={m.code} className="border-t border-line">
                      <th scope="row" className="px-5 py-3 text-left font-medium">
                        {marketLabel(m.code)}
                        <span className="ml-2 text-xs font-normal text-ink-3">{Math.round(m.share * 100)}%</span>
                      </th>
                      <td className="px-5 py-3 text-right">{formatPlnWhole(m.budget)}</td>
                      <td className="px-5 py-3 text-right">{formatPlnWhole(m.spentToDate)}</td>
                      <td
                        className={cn(
                          "px-5 py-3 text-right",
                          p?.tone === "bad" ? "text-negative" : p?.tone === "good" ? "text-positive" : "text-ink-2"
                        )}
                      >
                        {p?.text ?? "-"}
                      </td>
                      <td className="px-5 py-3 text-right">{formatPlnWhole(m.todayPlan)}</td>
                    </tr>
                  );
                })}
                {budget.unmappedBudget > 0 ? (
                  <tr className="border-t border-line text-ink-3">
                    <th scope="row" className="px-5 py-3 text-left font-normal">Kampanie bez rynku w nazwie</th>
                    <td className="px-5 py-3 text-right">{formatPlnWhole(budget.unmappedBudget)}</td>
                    <td className="px-5 py-3" colSpan={3} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

/** Cumulative plan (dashed) against cumulative spend (solid), in a 600x220 box. */
function BudgetChart({ budget }: { budget: SeasonBudget }) {
  const W = 600;
  const H = 220;
  const pts = budget.cumulative;
  const top = Math.max(budget.total, budget.projected ?? 0, pts[pts.length - 1]?.actual ?? 0) * 1.05 || 1;
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0);
  const y = (v: number) => H - (v / top) * H;
  const line = (vals: Array<number | null>) =>
    vals
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)} ${y(v).toFixed(1)}`))
      .filter(Boolean)
      .map((p, i) => `${i ? "L" : "M"}${p}`)
      .join(" ");
  const actual = pts.map((p) => p.actual);
  const lastActual = actual.reduce<number>((at, v, i) => (v !== null ? i : at), -1);
  const label = `Plan na koniec sezonu ${compactPln(budget.total)}, wydane do wczoraj ${compactPln(budget.spentToDate)} przy planie ${compactPln(budget.planToDate)}.`;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-3">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-5 rounded-full bg-[hsl(var(--lime-line))]" />
          wydane
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="w-5 border-t-[1.5px] border-dashed border-prev" />
          plan
        </span>
        <span className="ml-auto tabular-nums">budżet {compactPln(budget.total)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-56 w-full overflow-visible">
        <line x1={0} x2={W} y1={y(budget.total)} y2={y(budget.total)} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={line(pts.map((p) => p.plan))} fill="none" className="stroke-[var(--prev)]" strokeWidth={1.75} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        {lastActual >= 0 ? (
          <path d={line(actual)} fill="none" className="stroke-[hsl(var(--lime-line))]" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      <figcaption className="flex justify-between text-xs text-ink-3 tabular-nums">
        <span>{dayMonthLong(pts[0]?.date ?? "")}</span>
        <span>{dayMonthLong(pts[pts.length - 1]?.date ?? "")}</span>
      </figcaption>
    </figure>
  );
}
