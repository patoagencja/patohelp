import { formatNumberPL } from "@/lib/utils";

import { outOfTen, ShareBars, visitsUnit, type ShareRow } from "./share-bars";

const DEVICE: Record<string, { pl: string; en: string; bar: string }> = {
  mobile: { pl: "Telefon", en: "Mobile", bar: "bg-indigo-500" },
  desktop: { pl: "Komputer", en: "Desktop", bar: "bg-sky-500" },
  tablet: { pl: "Tablet", en: "Tablet", bar: "bg-slate-400" },
};

export function Devices({
  devices,
  lang = "pl",
  headingLevel = 2,
}: {
  devices: Array<{ device: string; sessions: number }>;
  lang?: "pl" | "en";
  headingLevel?: 2 | 3;
}) {
  const en = lang === "en";
  const rows: ShareRow[] = devices.map((d) => ({
    key: d.device,
    label: DEVICE[d.device]?.[en ? "en" : "pl"] ?? d.device,
    value: d.sessions,
    barClass: DEVICE[d.device]?.bar ?? "bg-slate-400",
  }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const mobile = rows.find((r) => r.key === "mobile")?.value ?? 0;
  // The practical takeaway: is the site judged on a phone or a laptop?
  const insight =
    total > 0 && !en
      ? mobile / total >= 0.5
        ? `${outOfTen(mobile / total)} gości ogląda stronę na telefonie - to wersja mobilna robi pierwsze wrażenie.`
        : `Większość gości ogląda stronę na komputerze (${outOfTen(1 - mobile / total)}).`
      : null;

  return (
    <ShareBars
      title={en ? "Devices" : "Na czym oglądają"}
      headingLevel={headingLevel}
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
