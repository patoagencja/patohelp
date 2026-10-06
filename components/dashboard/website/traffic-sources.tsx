import type { ReactNode } from "react";
import { Globe, Link2, Megaphone, MousePointerClick, Search, Users } from "lucide-react";

import { formatNumberPL } from "@/lib/utils";

import { outOfTen, ShareBars, visitsUnit, type ShareRow } from "./share-bars";

// Channel names in the words a client uses, not GA4's Paid/Organic/Direct.
const SOURCE_PL: Record<string, { label: string; hint: string; icon: ReactNode }> = {
  Paid: { label: "Z reklam", hint: "płatne kampanie", icon: <Megaphone /> },
  Organic: { label: "Z wyszukiwarki", hint: "bezpłatne wyniki Google", icon: <Search /> },
  Direct: { label: "Bezpośrednio", hint: "wpisali adres lub mają zakładkę", icon: <MousePointerClick /> },
  Social: { label: "Z social mediów", hint: "posty i profile, nie reklamy", icon: <Users /> },
  "Referral/Inne": { label: "Z innych stron", hint: "linki, newslettery i inne", icon: <Link2 /> },
};

const SOURCE_EN: Record<string, string> = {
  Paid: "Paid ads",
  Organic: "Organic search",
  Direct: "Direct",
  Social: "Social media",
  "Referral/Inne": "Referral / other",
};

export function TrafficSources({
  sources,
  lang = "pl",
}: {
  sources: Array<{ category: string; sessions: number }>;
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const rows: ShareRow[] = sources.map((s) => ({
    key: s.category,
    label: en ? SOURCE_EN[s.category] ?? s.category : SOURCE_PL[s.category]?.label ?? s.category,
    hint: en ? undefined : SOURCE_PL[s.category]?.hint,
    value: s.sessions,
    icon: SOURCE_PL[s.category]?.icon ?? <Globe />,
  }));

  const total = rows.reduce((a, r) => a + r.value, 0);
  const paid = rows.find((r) => r.key === "Paid")?.value ?? 0;
  const top = [...rows].sort((a, b) => b.value - a.value)[0];
  let insight: string | null = null;
  if (total > 0 && !en) {
    insight =
      paid > 0
        ? `${outOfTen(paid / total)} wizyt na stronie to efekt reklam.`
        : top
          ? `Najwięcej osób trafia na stronę: ${top.label.toLowerCase()}.`
          : null;
  }

  return (
    <ShareBars
      title={en ? "Where visitors come from" : "Skąd przychodzą goście"}
      insight={insight}
      rows={rows}
      unit={en ? (n) => `${formatNumberPL(n)} sessions` : visitsUnit}
      emptyText={
        en
          ? "Google Analytics data appears after the first sync."
          : "Dane z Google Analytics pojawią się po pierwszej synchronizacji."
      }
    />
  );
}
