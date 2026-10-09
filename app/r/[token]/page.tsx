import { formatInTimeZone } from "date-fns-tz";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { olxSmSlides } from "@/components/dashboard/report/olx-sm-slides";
import { AgencySignature, AgencyWatermark } from "@/components/ui/agency-mark";
import { Sky } from "@/components/ui/sky";
import { ReportDeck } from "@/components/dashboard/report/report-deck";
import { loadOlxSmReport } from "@/lib/report/olx-sm-data";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, read-only report view behind an unguessable token (see share_links).
// No session required - the token IS the access. Revoking the link kills it.
export const dynamic = "force-dynamic";

// Same as the board link (/s): keep the capability URL out of search indexes
// and out of the Referer sent to third parties (Meta CDN creative thumbnails).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

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
  // select("*") so this keeps working before migration 0026 adds kind/expires_at.
  const { data: link } = await admin
    .from("share_links")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();

  if (!link || link.revoked) notFound();
  // Board-overview tokens (/s/...) must not open the report deck, and vice versa.
  if ((link.kind ?? "report") !== "report") notFound();
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) notFound();

  const { data: client } = await admin
    .from("clients")
    .select("id, name, slug")
    .eq("id", link.client_id)
    .single();

  if (!client) notFound();

  // Anyone holding the link controls ?month=, and every month not yet in
  // report_cache costs a fresh Claude call (plus a cache row). Only the last
  // two years up to the current month are reachable; anything else (incl.
  // "2026-13", which made date-fns throw -> 500) falls back to the default.
  const monthParam = searchParams.month;
  const currentMonth = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM");
  const [cy, cm] = currentMonth.split("-").map(Number);
  const earliestMonth = `${cy - 2}-${String(cm).padStart(2, "0")}`;
  const monthOk =
    !!monthParam &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) &&
    monthParam >= earliestMonth &&
    monthParam <= currentMonth;
  const monthDate = monthOk ? new Date(`${monthParam}-15T00:00:00`) : undefined;

  // Same deck as the Raporty tab: numbers first, AI slides streamed in.
  const report = loadOlxSmReport(client.id, client.name, monthDate);
  report.ai.catch(() => {});
  const sm = await report.base;
  const foot = `${client.name} · ${sm.periodLabel} · patoagencja`;

  return (
    // relative + isolate: the pastel sky sits under the content.
    <div className="relative isolate min-h-screen bg-background">
      <Sky />
      <AgencyWatermark />
      <div className="pointer-events-none sticky top-0 z-30 mx-auto w-full max-w-6xl px-3 pt-2.5 sm:px-6 md:pt-3.5 print:hidden">
        <header className="glass glass-blur pointer-events-auto flex min-h-[62px] items-center justify-between gap-3 rounded-full py-2 pl-5 pr-5 md:min-h-16">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="kick !text-[11px]">Raport · {sm.monthLabel}</span>
            <span className="truncate text-[15px] font-semibold tracking-[-0.015em]">{client.name}</span>
          </span>
          <span className="kick hidden items-center gap-2 sm:inline-flex">
            <span className="ping ping-lime ping-still" aria-hidden />
            patoagencja
          </span>
        </header>
      </div>

      <main id="main" className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:p-6">
        <ReportDeck
          clientSlug={client.slug}
          range="prev_month"
          rangeLabel={sm.monthLabel}
          foot={foot}
          shareMode
        >
          {olxSmSlides({ ...sm, ai: report.ai }, foot)}
        </ReportDeck>
      </main>

      <AgencySignature className="pb-10" />
    </div>
  );
}
