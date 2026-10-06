// TEMPORARY scratch route for d26 state screenshots - delete before finishing.
import { CalendarX2, Hourglass } from "lucide-react";

import { CampaignGoals } from "@/components/dashboard/campaign-goals";
import { EmptyState } from "@/components/dashboard/empty-state";
import { NotFoundCard } from "@/components/dashboard/not-found-card";
import * as S from "@/components/dashboard/skeletons";
import { Button } from "@/components/ui/button";
import type { PacingFlight } from "@/lib/alerts/pacing";

import { ErrorPreview, FailingSection } from "./client";

export const dynamic = "force-dynamic";

async function noop() {
  "use server";
}

const FLIGHTS: PacingFlight[] = [
  { id: "f1", campaignId: "c1", campaignName: "PMAX | Ruch · Google", metric: "clicks", target: 56500, realized: 8093, startDate: "2026-10-01", endDate: "2026-10-31", status: "behind", realizedPct: 0.143, expectedPct: 0.18, paceRatio: 0.79, daysLeft: 25 },
  { id: "f2", campaignId: "c2", campaignName: "TRAFFIC | Ruch na stronę · Meta", metric: "spend", target: 1200000, realized: 260000, startDate: "2026-10-01", endDate: "2026-10-31", status: "on_track", realizedPct: 0.217, expectedPct: 0.2, paceRatio: 1.08, daysLeft: 25 },
  { id: "f3", campaignId: "c3", campaignName: "ENGAGEMENT | Instagram · Meta", metric: "impressions", target: 900000, realized: 0, startDate: "2026-11-01", endDate: "2026-11-30", status: "upcoming", realizedPct: 0, expectedPct: 0, paceRatio: null, daysLeft: 55 },
];

export default function Scratch({ searchParams }: { searchParams: { v?: string; agency?: string } }) {
  const v = searchParams.v ?? "misc";
  const Sk = (S as Record<string, unknown>)[v] as (() => JSX.Element) | undefined;
  if (Sk) return <Sk />;
  if (v === "error") return <ErrorPreview />;
  if (v === "goals")
    return (
      <CampaignGoals
        pacing={searchParams.agency === "empty" ? [] : FLIGHTS}
        isAgency={searchParams.agency !== "0"}
        clientSlug="demo-full"
        campaignOptions={[{ id: "c1", name: "PMAX | Ruch" }]}
        addAction={noop}
        deleteAction={noop}
      />
    );
  return (
    <>
      <EmptyState
        icon={Hourglass}
        title="Pierwsze dane już spływają"
        description="Podłączyliśmy Twoje konta. Pełny obraz zobaczysz jutro rano - panel uzupełni się sam."
      />
      <EmptyState
        icon={CalendarX2}
        title="W tym okresie kampania nie działała"
        description="Kampania ruszyła 14 września. Wybierz dłuższy zakres, żeby zobaczyć wyniki."
        action={<Button variant="chip" size="pill">Pokaż 30 dni</Button>}
      />
      <div className="glass rounded-card p-6">
        <EmptyState inset title="Brak danych" description="Inset wariant w karcie." />
      </div>
      <FailingSection />
      <NotFoundCard href="/demo-full" linkLabel="Wróć do przeglądu" />
    </>
  );
}
