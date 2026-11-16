import { AlertsBoard } from "@/components/dashboard/alert-explained";
import { CampaignGoals } from "@/components/dashboard/campaign-goals";
import { getDemoAlerts } from "@/lib/demo/alerts";
import { demoCampaignFlights } from "@/lib/demo/campaign-goals";
import { getDemoSource } from "@/lib/demo/profile/store";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

// Alerty board (2026 pastel): header + severity filter, one glass card per
// alert. Every top-level child is a presentation slide.
export default async function DemoFullAlerty({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const src = await getDemoSource();

  return (
    <>
      <AlertsBoard alerts={getDemoAlerts(src, lang)} lang={lang} />

      {/* The goal cards are the detail view the overview's goal tiles link
          to; a second row of tiles here showed the same goals twice. Polish
          only, like the live goals section. */}
      {en ? null : (
        <CampaignGoals
          pacing={demoCampaignFlights(src)}
          isAgency={false}
          clientSlug="demo-full"
          campaignOptions={[]}
          addAction={noop}
          deleteAction={noop}
        />
      )}

      <p className="max-w-3xl text-[13px] leading-relaxed text-ink-3">
        {en
          ? "Every day we compare the last few days with the previous two weeks, and each day with the same weekday over the last 4 weeks. During the day, every half hour, we also check that Google Analytics data keeps coming in and that the cart, payments and the Meta pixel work. Urgent issues, like a sudden spend spike, reach us right away."
          : "Codziennie porównujemy ostatnie dni z poprzednimi dwoma tygodniami, a każdy dzień także z tym samym dniem tygodnia z ostatnich 4 tygodni. W ciągu dnia co pół godziny sprawdzamy też, czy dane z Google Analytics spływają na bieżąco, a w sklepie - czy działają koszyk i płatności oraz piksel Meta. Pilne sprawy, np. nagły skok wydatków, trafiają do nas od razu."}
      </p>
    </>
  );
}
