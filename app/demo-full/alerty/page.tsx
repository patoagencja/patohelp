import { AlertsBoard } from "@/components/dashboard/alert-explained";
import { CampaignGoals } from "@/components/dashboard/campaign-goals";
import { GoalTiles } from "@/components/dashboard/goal-tiles";
import { demoCampaignFlights, demoGoalTiles } from "@/lib/demo/campaign-goals";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

// Alerty board (2026 pastel): header + severity filter, one glass card per
// alert. Every top-level child is a presentation slide.
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
      {/* Goal tiles + cards are Polish-only (like the live goals section). */}
      {en ? null : <GoalTiles goals={demoGoalTiles()} />}

      <AlertsBoard alerts={d.alertsFull} lang={lang} />

      {en ? null : (
        <CampaignGoals
          pacing={demoCampaignFlights()}
          isAgency={false}
          clientSlug="demo-full"
          campaignOptions={[]}
          addAction={noop}
          deleteAction={noop}
        />
      )}

      <p className="max-w-3xl text-[13px] leading-relaxed text-ink-3">
        {en
          ? "Every day we compare the last few days with the previous two weeks. Urgent issues, like a sudden spend spike, reach us right away."
          : "Codziennie porównujemy ostatnie dni z poprzednimi dwoma tygodniami. Pilne sprawy, np. nagły skok wydatków, trafiają do nas od razu."}
      </p>
    </>
  );
}
