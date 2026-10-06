import { BellRing } from "lucide-react";

import {
  AlertGroups,
  AlertsAllClear,
  alertsHeadline,
} from "@/components/dashboard/alert-explained";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullAlerty({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{en ? "Alerts" : "Alerty"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? "What's out of the ordinary in the campaigns - and what we're doing about it. Every day we compare the last few days with the previous two weeks."
            : "Co w kampaniach odbiega od normy - i co z tym robimy. Codziennie porównujemy ostatnie dni z poprzednimi dwoma tygodniami."}
        </p>
      </div>

      {d.alertsFull.length === 0 ? (
        <AlertsAllClear lang={lang} />
      ) : (
        <>
          <p className="text-balance text-base font-medium">{alertsHeadline(d.alertsFull, lang)}</p>
          <AlertGroups alerts={d.alertsFull} lang={lang} />
        </>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {en
            ? "Urgent issues, like a sudden spend spike, are detected automatically and reach us right away."
            : "Pilne sprawy, np. nagły skok wydatków, wykrywamy automatycznie - powiadomienie trafia do nas od razu."}
        </span>
      </div>
    </>
  );
}
