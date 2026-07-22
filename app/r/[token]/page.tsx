import { notFound } from "next/navigation";

import { olxSmSlides } from "@/components/dashboard/report/olx-sm-slides";
import { ReportDeck } from "@/components/dashboard/report/report-deck";
import { getOlxSmReportData } from "@/lib/report/olx-sm-data";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, read-only report view behind an unguessable token (see share_links).
// No session required - the token IS the access. Revoking the link kills it.
export const dynamic = "force-dynamic";

export default async function SharedReportPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { month?: string };
}) {
  // Token sanity check before touching the DB.
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(params.token)) notFound();

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("share_links")
    .select("client_id, revoked")
    .eq("token", params.token)
    .maybeSingle();

  if (!link || link.revoked) notFound();

  const { data: client } = await admin
    .from("clients")
    .select("id, name, slug")
    .eq("id", link.client_id)
    .single();

  if (!client) notFound();

  const monthParam = searchParams.month;
  const monthDate =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? new Date(`${monthParam}-15T00:00:00`)
      : undefined;

  const sm = await getOlxSmReportData(client.id, client.name, monthDate);
  const foot = `${client.name} · ${sm.periodLabel} · patoagencja`;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6 print:hidden">
        <span className="text-sm font-semibold">
          Raport - {client.name}{" "}
          <span className="font-normal text-muted-foreground">
            · {sm.monthLabel}
          </span>
        </span>
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          patoagencja
        </span>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <ReportDeck
          clientSlug={client.slug}
          range="prev_month"
          rangeLabel={sm.monthLabel}
          foot={foot}
          shareMode
        >
          {olxSmSlides(sm, foot)}
        </ReportDeck>
      </main>

      <footer className="pb-8 text-center text-xs text-muted-foreground print:hidden">
        Raport wygenerowany automatycznie przez patoagencja · dane z Meta Ads,
        Google Ads i TikTok Ads
      </footer>
    </div>
  );
}
