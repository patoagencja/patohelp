import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react";

import { getDemoDashboard } from "@/lib/demo/data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function DemoFullAlerty({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);

  const SEV = {
    critical: { label: en ? "Critical" : "Krytyczny", badge: "bg-red-600 text-white", dot: "bg-red-600" },
    high: { label: en ? "High" : "Wysoki", badge: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400", dot: "bg-red-400" },
    medium: { label: en ? "Medium" : "Średni", badge: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400", dot: "bg-amber-400" },
  } as const;

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          {en ? "Alerts" : "Alerty"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? "Automatic detection of spend and performance anomalies · email and Telegram notifications"
            : "Automatyczne wykrywanie odchyleń wydatków i wyników · powiadomienia na e-mail i Telegram"}
        </p>
      </div>

      <div className="divide-y divide-border/60 rounded-xl border border-border bg-card">
        {d.alertsFull.map((a) => {
          const s = SEV[a.severity];
          return (
            <div key={a.id} className="flex items-start gap-3 p-4">
              <span className="relative mt-1 flex h-2 w-2 shrink-0">
                {a.severity !== "medium" ? (
                  <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", s.dot)} />
                ) : null}
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", s.dot)} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.scopeLabel}</p>
                <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.badge)}>{s.label}</span>
                <span className={cn("inline-flex items-center gap-0.5 font-mono text-xs font-semibold", a.direction === "up" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                  {a.direction === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {a.changePct > 0 ? "+" : ""}{a.changePct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
