import {
  AlertGroups,
  AlertsAllClear,
  alertsHeadline,
} from "@/components/dashboard/alert-explained";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        title={en ? "Alerts" : "Alerty"}
        description={
          en
            ? "What's out of the ordinary in the campaigns, and what we're doing about it."
            : "Co w kampaniach odbiega od normy i co z tym robimy."
        }
      />

      {d.alertsFull.length === 0 ? (
        <AlertsAllClear lang={lang} />
      ) : (
        <div className="space-y-6">
          <p className="text-balance text-base font-medium">{alertsHeadline(d.alertsFull, lang)}</p>
          <AlertGroups alerts={d.alertsFull} lang={lang} />
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {en
          ? "Every day we compare the last few days with the previous two weeks. Urgent issues, like a sudden spend spike, reach us right away."
          : "Codziennie porównujemy ostatnie dni z poprzednimi dwoma tygodniami. Pilne sprawy, np. nagły skok wydatków, trafiają do nas od razu."}
      </p>
    </>
  );
}
