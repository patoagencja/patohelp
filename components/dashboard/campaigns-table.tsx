"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Title } from "@tremor/react";

import type { CampaignRow, CampaignStatus } from "@/lib/dashboard/metrics";
import { cn, formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

const STATUS_META: Record<CampaignStatus, { dot: string; label: string }> = {
  active: { dot: "bg-emerald-500", label: "Aktywna" },
  paused: { dot: "bg-amber-500", label: "Wstrzymana" },
  off: { dot: "bg-red-500", label: "Nieaktywna" },
};

const PROVIDER_LABEL: Record<CampaignRow["provider"], string> = {
  meta_ads: "Meta",
  google_ads: "Google",
};

type SortKey = "name" | "provider" | "spendMinorUnits" | "clicks" | "ctr" | "status";

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "status", label: "Status" },
  { key: "name", label: "Kampania" },
  { key: "provider", label: "Źródło" },
  { key: "spendMinorUnits", label: "Wydatki", numeric: true },
  { key: "clicks", label: "Kliknięcia", numeric: true },
  { key: "ctr", label: "CTR", numeric: true },
];

export function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("spendMinorUnits");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...campaigns];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [campaigns, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(false);
    }
  }

  if (!campaigns.length) {
    return (
      <Card>
        <Title>Aktywne kampanie</Title>
        <p className="mt-4 text-sm text-muted-foreground">
          Brak kampanii z wydatkami w tym miesiącu.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Title>Aktywne kampanie</Title>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "cursor-pointer select-none py-2 font-medium",
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr
                key={`${c.provider}:${c.campaignId}`}
                className="border-b border-border/60 last:border-0"
              >
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        STATUS_META[c.status].dot
                      )}
                      title={STATUS_META[c.status].label}
                    />
                  </span>
                </td>
                <td className="max-w-xs truncate py-2 pr-4" title={c.name}>
                  {c.name}
                </td>
                <td className="py-2 pr-4">{PROVIDER_LABEL[c.provider]}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatMoneyPLN(c.spendMinorUnits)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumberPL(c.clicks)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatPercent(c.ctr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
