import type { CSSProperties } from "react";
import { ArrowRight, ChevronDown, CircleCheck } from "lucide-react";

import { CreativeThumb } from "@/components/dashboard/creatives/creative-thumb";
import { EmptyState } from "@/components/dashboard/empty-state";
import type { AbAction, AbAd } from "@/lib/ab/types";
import { cn } from "@/lib/utils";

import { ACTION, actionCopy, changesWord, fmtEstimate, formatOf, setShort } from "./ab-meta";
import { KindChip } from "./kind-chip";

const H2 = "mt-2 text-[22px] font-medium tracking-[-0.03em] text-foreground";

/** Proposals shown on arrival; the rest wait behind "Pokaż wszystkie". */
const SHOWN = 3;

function Impact({ action, className }: { action: AbAction; className?: string }) {
  const meta = ACTION[action.kind];
  return (
    <div className={cn("min-w-0", className)}>
      <p className="whitespace-nowrap text-[22px] font-light leading-none tracking-[-0.03em] tabular-nums sm:text-[26px]">
        ~{meta.plus ? "+" : ""}
        {fmtEstimate(action.impactPerDay)}
      </p>
      <p className="mt-1 text-[12px] leading-tight text-ink-3">{meta.impact}</p>
    </div>
  );
}

function ActionRow({ action: a, ad, index }: { action: AbAction; ad: AbAd | undefined; index: number }) {
  const { title, detail } = actionCopy(a, ad);
  return (
    <li className="animate-rise" style={{ "--d": `${0.1 + Math.min(index, SHOWN) * 0.05}s` } as CSSProperties}>
      <a
        href={`#ad-${a.adId}`}
        className="group flex flex-col gap-3 rounded-[22px] bg-chip p-4 transition-[background-color,transform] duration-200 hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-5 sm:p-5 motion-safe:active:scale-[0.995]"
      >
        {/* Phones: the proposal and its amount share the top line. */}
        <div className="flex items-start justify-between gap-3 sm:hidden">
          <KindChip meta={ACTION[a.kind]} />
          <Impact action={a} className="text-right" />
        </div>
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          {ad ? (
            <CreativeThumb
              src={ad.thumbnailUrl}
              name={ad.adName}
              format={formatOf(ad)}
              compact
              className="h-12 w-12 rounded-[14px]"
            />
          ) : null}
          <div className="min-w-0">
            <KindChip meta={ACTION[a.kind]} className="mb-1.5 hidden sm:inline-flex" />
            {/* The same creative runs in many tests: say which one this is. */}
            {ad ? (
              <p className="mb-0.5 text-[12.5px] leading-snug text-ink-2">{setShort(ad.adsetName, ad.market)}</p>
            ) : null}
            <p className="text-base font-medium leading-snug tracking-[-0.01em] text-foreground">{title}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">{detail}</p>
          </div>
        </div>
        <Impact action={a} className="hidden w-[11rem] shrink-0 text-right sm:block" />
        <ArrowRight
          aria-hidden
          className="hidden h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 sm:block"
        />
      </a>
    </li>
  );
}

/**
 * "Nasze propozycje": the agency's short list for the owner, most sales at
 * stake first (the order comes from lib/ab/stats: decisions, then ads we
 * keep an eye on). The top three show; the rest fold behind one button so
 * the owner isn't handed eight decisions at once. Each row is a link to the
 * ad inside its test (#ad-...), where the explorer opens the right test and
 * highlights the row.
 */
export function AbActions({
  actions,
  ads,
  finished = false,
}: {
  actions: AbAction[];
  ads: Record<string, AbAd>;
  /** A past period (a finished season): verdicts only, nothing to do today. */
  finished?: boolean;
}) {
  const decisions = actions.filter((a) => a.kind !== "watch").length;
  const rest = actions.slice(SHOWN);
  return (
    <section aria-labelledby="ab-actions-heading" className="glass min-w-0 rounded-glass p-5 sm:p-7">
      <div className="mb-5 sm:mb-6">
        <p className="kick">Nasze propozycje na dziś</p>
        <h2 id="ab-actions-heading" className={H2}>
          {decisions > 0 ? `Proponujemy ${decisions} ${changesWord(decisions)}` : "Na dziś bez zmian"}
        </h2>
        {actions.length > 0 ? (
          <p className="mt-1.5 text-sm text-ink-3">
            Najpierw te, które dadzą najwięcej sprzedaży (liczymy na pełnych dniach). Kliknij, żeby zobaczyć reklamę w
            jej teście.
          </p>
        ) : null}
      </div>

      {actions.length === 0 ? (
        finished ? (
          <EmptyState
            inset
            icon={CircleCheck}
            title="Ten okres już się skończył."
            description="Werdykty poniżej mówią, co działało w tym okresie. Propozycje na dziś liczymy w okresach kończących się wczoraj."
          />
        ) : (
          <EmptyState
            inset
            icon={CircleCheck}
            title="Nic pilnego - testy idą równo."
            description="Żadna reklama nie odstaje na tyle, żeby coś zmieniać. Zajrzyj jutro albo wybierz dłuższy okres."
          />
        )
      ) : (
        <>
          <ol className="space-y-2.5">
            {actions.slice(0, SHOWN).map((a, i) => (
              <ActionRow key={`${a.kind}-${a.adId}`} action={a} ad={ads[a.adId]} index={i} />
            ))}
          </ol>
          {rest.length > 0 ? (
            // Native disclosure: works before hydration, and prints open
            // (data-print-open) - paper can't be clicked.
            <details data-print-open className="group mt-2.5">
              <summary className="mx-auto flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-full bg-chip px-[18px] text-sm font-medium text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:active:scale-100 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Pokaż wszystkie ({actions.length})</span>
                <span className="hidden group-open:inline">Pokaż tylko {SHOWN} pierwsze</span>
                <ChevronDown aria-hidden className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <ol start={SHOWN + 1} className="mt-2.5 space-y-2.5">
                {rest.map((a, i) => (
                  <ActionRow key={`${a.kind}-${a.adId}`} action={a} ad={ads[a.adId]} index={SHOWN + i} />
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
