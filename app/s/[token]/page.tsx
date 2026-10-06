import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AiSummaryCard } from "@/components/dashboard/ai-summary-card";
import { CampaignPositions } from "@/components/dashboard/campaign-positions";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { EcommerceKpis } from "@/components/dashboard/ecommerce-kpis";
import { MonthPacingCard } from "@/components/dashboard/ecom/month-pacing-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MainChart } from "@/components/dashboard/main-chart";
import { PresentationMode } from "@/components/dashboard/presentation-mode";
import { PrintButton, PrintHeader } from "@/components/dashboard/print-button";
import { RecordsSection } from "@/components/dashboard/records-section";
import { StoryHero } from "@/components/dashboard/story-hero";
import {
  TopCreatives,
  type CreativeRow,
} from "@/components/dashboard/top-creatives";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import {
  RANGE_KEYS,
  RANGE_LABELS,
  getDashboardData,
  normalizeRange,
  type TrendPoint,
} from "@/lib/dashboard/metrics";
import type { AiSummary, ClientEvent } from "@/lib/dashboard/overview";
import { clientAccentStyle, getClientBranding } from "@/lib/dashboard/branding";
import { buildStory } from "@/lib/dashboard/story";
import { getEngagementYoY } from "@/lib/dashboard/yoy";
import { getMonthPacing } from "@/lib/ecom/insights";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

// Public, read-only board view of one client's overview behind an
// unguessable token (share_links.kind = 'overview'). No session: the token IS
// the access, so every read below goes through the service-role client and is
// explicitly filtered by the link's client_id - never by anything from the URL.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Podgląd kampanii - tylko do odczytu",
  robots: { index: false, follow: false, nocache: true },
  // The token lives in the path; don't hand it to third parties (e.g. the
  // Meta CDN serving creative thumbnails) via the Referer header.
  referrer: "no-referrer",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

interface ShareLinkRow {
  client_id: string;
  revoked: boolean;
  expires_at: string | null;
}

/** Valid, non-revoked, non-expired overview link -> its client_id. */
async function resolveOverviewLink(
  admin: SupabaseClient,
  token: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("share_links")
    .select("client_id, revoked, expires_at")
    .eq("token", token)
    .eq("kind", "overview")
    .maybeSingle();
  // Any error (e.g. migration 0026 not applied yet) fails closed.
  if (error || !data) return null;
  const link = data as ShareLinkRow;
  if (link.revoked) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    return null;
  }
  return link.client_id;
}

async function getClient(admin: SupabaseClient, clientId: string) {
  const { data } = await admin
    .from("clients")
    .select("id, slug, name, client_type")
    .eq("id", clientId)
    .maybeSingle();
  if (data) {
    const row = data as { id: string; slug: string; name: string; client_type?: string };
    return {
      id: row.id,
      // Only used to pick a built-in SVG logo; never echoed into links.
      slug: row.slug,
      name: row.name,
      ecommerce: row.client_type === "ecommerce",
    };
  }
  // Pre-0016 databases have no client_type column.
  const { data: basic } = await admin
    .from("clients")
    .select("id, slug, name")
    .eq("id", clientId)
    .maybeSingle();
  return basic
    ? {
        id: basic.id as string,
        slug: basic.slug as string,
        name: basic.name as string,
        ecommerce: false,
      }
    : null;
}

// The helpers in lib/dashboard/overview.ts read through the cookie-bound RLS
// client, which returns nothing for an anonymous visitor. These are the same
// queries on the admin client, pinned to the link's client_id.

async function getSummary(
  admin: SupabaseClient,
  clientId: string
): Promise<AiSummary | null> {
  const { data } = await admin
    .from("ai_summaries")
    .select("summary_text, generated_at, period_start, period_end")
    .eq("client_id", clientId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    summaryText: data.summary_text as string,
    generatedAt: data.generated_at as string,
    periodStart: data.period_start as string,
    periodEnd: data.period_end as string,
  };
}

async function getEventsFor(
  admin: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<ClientEvent[]> {
  // Service-role reads bypass RLS: agency-only notes must be filtered here or
  // they'd be shown on a public board link. Before migration 0029 the column
  // doesn't exist and every event is visible.
  const base = () =>
    admin
      .from("client_events")
      .select("id, event_date, title, description, event_type")
      .eq("client_id", clientId)
      .gte("event_date", start)
      .lte("event_date", end)
      .order("event_date", { ascending: false });
  const visible = await base().eq("visible_to_client", true);
  const { data } = visible.error ? await base() : visible;
  return (data ?? []).map((e) => ({
    id: e.id as string,
    eventDate: e.event_date as string,
    title: e.title as string,
    description: e.description as string | null,
    eventType: e.event_type as string | null,
  }));
}

async function getCreatives(
  admin: SupabaseClient,
  clientId: string
): Promise<CreativeRow[]> {
  const { data } = await admin
    .from("creatives")
    .select("ad_id, ad_name, thumbnail_url, spend_minor_units, ctr, cpc_minor_units")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(5);
  return (data ?? []).map((c) => ({
    adId: c.ad_id as string,
    adName: (c.ad_name as string) || (c.ad_id as string),
    thumbnailUrl: c.thumbnail_url as string | null,
    spendMinorUnits: Number(c.spend_minor_units),
    ctr: c.ctr != null ? Number(c.ctr) : null,
    cpcMinorUnits: c.cpc_minor_units != null ? Number(c.cpc_minor_units) : null,
  }));
}

// Client components get their props serialized into the public HTML. For
// engagement clients strip GA4 revenue/transactions so they never leave the
// server, even though no widget would render them.
function withoutRevenue(points: TrendPoint[]): TrendPoint[] {
  return points.map((p) => ({ ...p, revenueMinorUnits: 0, transactions: 0 }));
}

export default async function SharedOverviewPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { range?: string };
}) {
  // Cheap format check before touching the DB.
  if (!TOKEN_RE.test(params.token)) notFound();

  const admin = createAdminClient();
  const clientId = await resolveOverviewLink(admin, params.token);
  if (!clientId) notFound();

  const [client, branding] = await Promise.all([
    getClient(admin, clientId),
    // Pre-0031 databases just keep the default look.
    getClientBranding(admin, clientId),
  ]);
  if (!client) notFound();

  // Presets only - no custom from/to on the public view.
  const range = normalizeRange(searchParams.range);

  const [data, summary, creatives, monthPacing] = await Promise.all([
    getDashboardData(client.id, range, null, admin),
    getSummary(admin, client.id),
    getCreatives(admin, client.id),
    client.ecommerce ? getMonthPacing(client.id) : Promise.resolve(null),
    // Best-effort usage stamp so the agency can see whether a link is live
    // before deciding to revoke it. Never blocks or breaks the page.
    admin
      .from("share_links")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("token", params.token)
      .eq("kind", "overview")
      .then(
        () => undefined,
        () => undefined
      ),
  ]);
  const [events, yoy] = await Promise.all([
    getEventsFor(admin, client.id, data.rangeStart, data.rangeEnd),
    // No session here: read through the admin client pinned to the link's client.
    getEngagementYoY(client.id, data.rangeStart, data.rangeEnd, admin),
  ]);
  const trend = client.ecommerce ? data.trend : withoutRevenue(data.trend);
  const prevTrend =
    client.ecommerce || !data.prevTrend ? data.prevTrend : withoutRevenue(data.prevTrend);

  const basePath = `/s/${params.token}`;

  return (
    <div
      className="min-h-screen bg-background"
      style={clientAccentStyle(branding.brandColor)}
    >
      <header
        data-present-hide
        data-chrome-header
        className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-transparent bg-chrome/75 px-4 py-2 backdrop-blur-xl backdrop-saturate-150 sm:px-6 print:hidden"
      >
        {/* The board sees the client's own mark first; no initials badge when
            there is no logo - the name right next to it says it already. */}
        <ClientBrandMark
          name={client.name}
          slug={client.slug}
          logoUrl={branding.logoUrl}
          className="h-9 max-w-[10rem] shrink-0 text-foreground [&:not(img)]:h-6"
          fallback={null}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{client.name}</p>
          <p className="text-xs text-muted-foreground">
            Podgląd tylko do odczytu · przygotowane przez Pato
          </p>
        </div>
        <span className="flex-1" />
        <PresentationMode
          brand={
            <ClientBrandMark
              name={client.name}
              slug={client.slug}
              logoUrl={branding.logoUrl}
              className="h-8"
              fallback={<span className="text-sm font-semibold">{client.name}</span>}
            />
          }
        />
        <PrintButton />
      </header>

      <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <PrintHeader
          clientName={client.name}
          periodLabel={data.rangeLabel}
          clientSlug={client.slug}
          logoUrl={branding.logoUrl}
        />

        <nav
          aria-label="Zakres dat"
          data-present-hide
          data-print-hide
          className={cn(segmentedTrack, "mb-6 mt-2")}
        >
          {RANGE_KEYS.map((key) => (
            <Link
              key={key}
              href={`${basePath}?range=${key}`}
              prefetch={false}
              aria-current={key === range ? "page" : undefined}
              className={segmentedItem(key === range)}
            >
              {RANGE_LABELS[key]}
            </Link>
          ))}
        </nav>

        <div data-present-deck className="space-y-6">
          <StoryHero
            story={buildStory({
              kpis: data.kpis,
              trend: data.trend,
              // Engagement clients never see revenue.
              ecommerce: client.ecommerce ? data.ecommerce : null,
              yoy,
            })}
            periodLabel={data.rangeLabel}
          />

          {/* Cached history scan can be cold - never hold the page for it. */}
          <Suspense fallback={null}>
            <RecordsSection clientId={client.id} ecommerce={client.ecommerce} />
          </Suspense>

          <MainChart
            trend={trend}
            prevTrend={prevTrend}
            events={events}
            autoEvents={data.autoEvents}
            yoy={yoy}
            label={data.rangeLabel}
          />

          {client.ecommerce ? (
            <>
              {monthPacing ? (
                // isAgency=false hides the "set a goal" link into settings.
                <MonthPacingCard pacing={monthPacing} clientSlug="" isAgency={false} />
              ) : null}
              <EcommerceKpis data={data.ecommerce} />
            </>
          ) : (
            <KpiCards kpis={data.kpis} trend={trend} />
          )}

          <CampaignPositions campaigns={data.campaigns} />

          {creatives.length > 0 ? <TopCreatives creatives={creatives} /> : null}

          {summary ? <AiSummaryCard summary={summary} /> : null}
        </div>
      </main>

      <footer
        data-present-hide
        className="pb-8 text-center text-xs text-muted-foreground print:hidden"
      >
        Dane z platform reklamowych i Google Analytics 4 · przygotowane przez
        Pato
      </footer>
    </div>
  );
}
