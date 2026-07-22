import { redirect } from "next/navigation";
import { ImageOff, MousePointerClick, Percent, Trophy, Wallet } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Creative {
  adId: string;
  name: string;
  campaignId: string | null;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

type SortKey = "spend" | "ctr" | "cpc" | "clicks";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "spend", label: "Wydatki" },
  { key: "clicks", label: "Kliknięcia" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
];

// Ranking eligibility floor - tiny ads with 3 impressions produce absurd CTRs.
const MIN_IMPRESSIONS = 1000;

function Thumb({
  c,
  className,
  rank,
}: {
  c: Creative;
  className?: string;
  rank?: number;
}) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-xl bg-muted", className)}>
      {c.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={c.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-5 w-5" />
        </span>
      )}
      {rank ? (
        <span
          className={cn(
            "absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow",
            rank === 1 ? "bg-amber-500" : rank === 2 ? "bg-slate-400" : rank === 3 ? "bg-orange-700" : "bg-slate-600"
          )}
        >
          {rank}
        </span>
      ) : null}
    </div>
  );
}

function RankList({
  title,
  icon: Icon,
  items,
  value,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Creative[];
  value: (c: Creative) => string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-indigo-500" />
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Brak danych.</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {items.map((c, i) => (
            <li key={c.adId} className="flex items-center gap-3">
              <Thumb c={c} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={c.name}>
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                    {i + 1}.
                  </span>
                  {c.name}
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                {value(c)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default async function KreacjePage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: { sort?: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("creatives")
    .select(
      "ad_id, ad_name, campaign_id, thumbnail_url, spend_minor_units, impressions, clicks, ctr, cpc_minor_units, period_start, period_end"
    )
    .eq("client_id", client.id)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(300);

  const creatives: Creative[] = (data ?? []).map((c) => ({
    adId: c.ad_id as string,
    name: (c.ad_name as string) || (c.ad_id as string),
    campaignId: c.campaign_id as string | null,
    thumbnailUrl: c.thumbnail_url as string | null,
    spend: Number(c.spend_minor_units),
    impressions: Number(c.impressions),
    clicks: Number(c.clicks),
    ctr: c.ctr != null ? Number(c.ctr) : null,
    cpc: c.cpc_minor_units != null ? Number(c.cpc_minor_units) : null,
    periodStart: c.period_start as string | null,
    periodEnd: c.period_end as string | null,
  }));

  const period = creatives[0]?.periodStart
    ? `${creatives[0].periodStart} - ${creatives[0].periodEnd}`
    : "ostatnie 30 dni";

  // Podium: top 5 by spend.
  const top5 = creatives.slice(0, 5);

  // Rankings (with an impressions floor so micro-tests don't dominate).
  const eligible = creatives.filter((c) => c.impressions >= MIN_IMPRESSIONS);
  const topCtr = [...eligible]
    .filter((c) => c.ctr != null)
    .sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0))
    .slice(0, 5);
  const bestCpc = [...eligible]
    .filter((c) => c.cpc != null && c.clicks > 0)
    .sort((a, b) => (a.cpc ?? 0) - (b.cpc ?? 0))
    .slice(0, 5);
  const topClicks = [...eligible].sort((a, b) => b.clicks - a.clicks).slice(0, 5);

  // Sortable full table.
  const sort: SortKey = (SORTS.find((s) => s.key === searchParams.sort)?.key ??
    "spend") as SortKey;
  const table = [...creatives]
    .sort((a, b) => {
      if (sort === "ctr") return (b.ctr ?? -1) - (a.ctr ?? -1);
      if (sort === "cpc") return (a.cpc ?? Infinity) - (b.cpc ?? Infinity);
      if (sort === "clicks") return b.clicks - a.clicks;
      return b.spend - a.spend;
    })
    .slice(0, 50);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Kreacje - {client.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wyniki na poziomie pojedynczych reklam (Meta) · {period} · odświeżane
          automatycznie co 6h.
        </p>
      </div>

      {creatives.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <ImageOff className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Brak danych o kreacjach</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Kliknij „Odśwież" u góry albo poczekaj na najbliższą synchronizację
            kreacji (co 6h).
          </p>
        </div>
      ) : (
        <>
          {/* Podium: top 5 by spend */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Trophy className="h-4 w-4 text-amber-500" />
              Top 5 kreacji wg wydatków
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {top5.map((c, i) => (
                <div
                  key={c.adId}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <Thumb c={c} className="h-36 w-full rounded-none" rank={i + 1} />
                  <div className="space-y-1.5 p-3">
                    {/* Full name on hover: instant custom tooltip. */}
                    <div className="group/name relative">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-max max-w-xs whitespace-normal rounded-md bg-foreground px-2 py-1 text-xs font-normal text-background shadow-lg group-hover/name:block">
                        {c.name}
                      </span>
                    </div>
                    <p className="font-mono text-base font-bold tabular-nums">
                      {formatMoneyPLN(c.spend)}
                    </p>
                    <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                      <span>CTR {formatPercent(c.ctr ?? 0)}</span>
                      <span>
                        CPC {c.cpc != null ? formatMoneyPLN(Math.round(c.cpc)) : "-"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Rankings */}
          <section className="grid gap-4 lg:grid-cols-3">
            <RankList
              title="Najwyższy CTR"
              icon={Percent}
              items={topCtr}
              value={(c) => formatPercent(c.ctr ?? 0)}
            />
            <RankList
              title="Najtańszy klik (CPC)"
              icon={Wallet}
              items={bestCpc}
              value={(c) => formatMoneyPLN(Math.round(c.cpc ?? 0))}
            />
            <RankList
              title="Najwięcej kliknięć"
              icon={MousePointerClick}
              items={topClicks}
              value={(c) => formatNumberPL(c.clicks)}
            />
          </section>
          <p className="-mt-3 text-xs text-muted-foreground">
            Rankingi liczone dla kreacji z min. {formatNumberPL(MIN_IMPRESSIONS)}{" "}
            wyświetleń.
          </p>

          {/* Full table with sort */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold">
                Wszystkie kreacje ({Math.min(creatives.length, 50)}
                {creatives.length > 50 ? ` z ${creatives.length}` : ""})
              </h2>
              <div className="flex rounded-lg bg-muted p-1">
                {SORTS.map((s) => (
                  <a
                    key={s.key}
                    href={`/${params.clientSlug}/kreacje?sort=${s.key}`}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                      sort === s.key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Kreacja</th>
                    <th className="py-2 pr-3 text-right font-medium">Wydatki</th>
                    <th className="py-2 pr-3 text-right font-medium">Wyśw.</th>
                    <th className="py-2 pr-3 text-right font-medium">Klik.</th>
                    <th className="py-2 pr-3 text-right font-medium">CTR</th>
                    <th className="py-2 text-right font-medium">CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((c) => (
                    <tr
                      key={c.adId}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                    >
                      <td className="max-w-[22rem] py-2 pr-3">
                        <div className="flex items-center gap-2.5">
                          <Thumb c={c} className="h-9 w-9" />
                          <span className="truncate text-sm" title={c.name}>
                            {c.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums">
                        {formatMoneyPLN(c.spend)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {formatNumberPL(c.impressions)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {formatNumberPL(c.clicks)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {formatPercent(c.ctr ?? 0)}
                      </td>
                      <td className="py-2 text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {c.cpc != null ? formatMoneyPLN(Math.round(c.cpc)) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
