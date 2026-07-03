"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, SparkAreaChart, Title } from "@tremor/react";

import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

const STATUS_META: Record<CampaignStatus, { dot: string; label: string }> = {
  active: { dot: "bg-emerald-500", label: "OK" },
  attention: { dot: "bg-amber-500", label: "Wymaga uwagi" },
  critical: { dot: "bg-red-500", label: "Problem" },
  off: { dot: "bg-slate-300", label: "Nieaktywna" },
};

const PROVIDER_META: Record<
  CampaignRow["provider"],
  { label: string; className: string }
> = {
  meta_ads: { label: "Meta", className: "bg-blue-50 text-blue-700" },
  google_ads: { label: "Google", className: "bg-amber-50 text-amber-700" },
};

type SortKey =
  | "name"
  | "provider"
  | "spendMinorUnits"
  | "clicks"
  | "ctr"
  | "cpcMinorUnits"
  | "conversions";

type FilterKey = "all" | "active" | "attention";

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "provider", label: "Platforma" },
  { key: "name", label: "Kampania" },
  { key: "spendMinorUnits", label: "Wydatki", numeric: true },
  { key: "ctr", label: "CTR", numeric: true },
  { key: "cpcMinorUnits", label: "CPC", numeric: true },
  { key: "conversions", label: "Konw.", numeric: true },
];

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "Wszystkie" },
  { key: "active", label: "Aktywne" },
  { key: "attention", label: "Wymagają uwagi" },
];

export function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("spendMinorUnits");
  const [asc, setAsc] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => {
    if (filter === "active") {
      return campaigns.filter((c) => c.status !== "off");
    }
    if (filter === "attention") {
      return campaigns.filter(
        (c) => c.status === "attention" || c.status === "critical"
      );
    }
    return campaigns;
  }, [campaigns, filter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Title>Kampanie</Title>
        <div className="flex rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Brak kampanii w tym widoku.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Status</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "cursor-pointer select-none py-2 pr-4 font-medium",
                      col.numeric ? "text-right" : "text-left"
                    )}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        col.numeric && "flex-row-reverse"
                      )}
                    >
                      {col.label}
                      {sortKey === col.key ? (
                        asc ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : null}
                    </span>
                  </th>
                ))}
                <th className="py-2 text-right font-medium">7 dni</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr
                  key={`${c.provider}:${c.campaignId}`}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2 pr-2">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        STATUS_META[c.status].dot
                      )}
                      title={c.statusReason ?? STATUS_META[c.status].label}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        PROVIDER_META[c.provider].className
                      )}
                    >
                      {PROVIDER_META[c.provider].label}
                    </span>
                  </td>
                  <td className="max-w-[16rem] truncate py-2 pr-4" title={c.name}>
                    {c.name}
                    {c.statusReason ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.statusReason}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoneyPLN(c.spendMinorUnits)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPercent(c.ctr)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {c.cpcMinorUnits != null
                      ? formatMoneyPLN(Math.round(c.cpcMinorUnits))
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {c.conversions > 0 ? formatNumberPL(c.conversions) : "—"}
                  </td>
                  <td className="py-2">
                    <SparkAreaChart
                      data={c.spark.map((v, i) => ({ i, v: v / 100 }))}
                      index="i"
                      categories={["v"]}
                      colors={["indigo"]}
                      className="ml-auto h-8 w-24"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
