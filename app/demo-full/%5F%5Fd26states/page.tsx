// TEMPORARY scratch route for d26 state screenshots - delete before finishing.
import { AlertTriangle, CalendarX2, Hourglass, RefreshCw } from "lucide-react";

import { AlertsDigest } from "@/components/dashboard/alerts-digest";
import { HealthNote } from "@/components/dashboard/integration-health-banner";
import { getDemoDashboard } from "@/lib/demo/data";

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
  if (v === "digest")
    return (
      <>
        <AlertsDigest alerts={getDemoDashboard().alerts} clientSlug="demo-full" />
        <AlertsDigest alerts={[]} clientSlug="demo-full" linkless />
      </>
    );
  if (v === "health")
    return (
      <div className="-mx-4 space-y-0 sm:-mx-6">
        <HealthNote role="status" tone="warning" icon={AlertTriangle} title="Jedno źródło danych nie działa - liczby poniżej są niepełne.">
          <ul><li><span className="font-medium text-foreground">Google Ads</span>: brak danych od 2 dni (ostatnia próba przed chwilą), agencja widzi ten problem w swoim panelu.</li></ul>
        </HealthNote>
        <HealthNote tone="warning" icon={AlertTriangle} title="Token wkrótce wygaśnie" chip="Widzi tylko agencja">
          <p><span className="font-medium text-foreground">Meta</span>: token wygaśnie za 5 dni - <a className="font-medium text-foreground underline underline-offset-2" href="#">wklej token, który nie wygasa</a>, żeby dane się nie urwały.</p>
        </HealthNote>
        <HealthNote tone="neutral" icon={RefreshCw}>
          <p><span className="font-medium text-foreground">GA4</span>: połączone ponownie - brakujące dane dociągniemy przy najbliższej synchronizacji (zwykle do 30 min).</p>
        </HealthNote>
      </div>
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
