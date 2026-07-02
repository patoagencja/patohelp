import { createClient } from "@/lib/supabase/server";

// Placeholder client dashboard. The real KPI cards, charts, campaign table,
// traffic sources and AI summary land in Phase 3.
export default async function ClientDashboardPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">
        Cześć {user?.email}, jesteś w dashboardzie klienta{" "}
        <span className="uppercase">{params.clientSlug}</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dane pojawią się tutaj po skonfigurowaniu integracji (Faza 2) i
        zbudowaniu widoków (Faza 3).
      </p>
    </div>
  );
}
