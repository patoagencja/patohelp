import { Card, Title } from "@tremor/react";

import { formatNumberPL, formatPercent } from "@/lib/utils";

// TODO: avg session duration per page (not stored in ga4_daily yet).
export function TopPages({
  pages,
  lang = "pl",
}: {
  pages: Array<{ path: string; views: number; engagementRate: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  return (
    <Card>
      <Title>{en ? "Top pages" : "Najpopularniejsze strony"}</Title>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">{en ? "Page" : "Strona"}</th>
              <th className="py-2 text-right font-medium">{en ? "Views" : "Odsłony"}</th>
              <th className="py-2 text-right font-medium">{en ? "Engagement" : "Zaangażowanie"}</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.path} className="border-b border-border/60 last:border-0">
                <td className="max-w-[16rem] truncate py-2 pr-4" title={p.path}>
                  {p.path}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumberPL(p.views)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatPercent(p.engagementRate, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
