import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  BarList,
  ContentSlide,
  CoverSlide,
  CreativesGrid,
  DECK_COLORS,
  DividerSlide,
  Donut,
  DualLineChart,
  LineChart,
  Stat,
} from "@/components/dashboard/report/deck";
import { olxSmSlides } from "@/components/dashboard/report/olx-sm-slides";
import { ShareCopyButton } from "../settings/share-copy-button";
import { ReportDeck } from "@/components/dashboard/report/report-deck";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getOlxSmReportData } from "@/lib/report/olx-sm-data";
import { ClientBrandMark } from "@/components/dashboard/client-brand-mark";
import { clientLogo } from "@/components/dashboard/client-logo";
import { regionPL } from "@/components/dashboard/website/audience";
import { getClientBySlug, getViewer } from "@/lib/dashboard/context";
import { getDemographics, genderLabel } from "@/lib/dashboard/demographics";
import { getWebsiteData } from "@/lib/dashboard/ga4-metrics";
import type { Kpi } from "@/lib/dashboard/metrics";
import {
  loadDashboardData,
  normalizeRange,
  parseCustomRange,
} from "@/lib/dashboard/metrics";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";
import {
  formatDateWarsaw,
  formatMoneyPLN,
  formatNumberPL,
  formatPercent,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

// share_links gains `kind` with migration 0026 (board overview links share
// the table). Filtering on a column that doesn't exist yet would break report
// sharing for anyone who deploys before running the SQL, so only filter when
// it's there.
async function hasLinkKind(admin: ReturnType<typeof createAdminClient>) {
  const { error } = await admin.from("share_links").select("kind").limit(1);
  return !error;
}

// Server action: create (or reuse) a public share link for this client's report.
async function createShareLink(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  // Report links expire after 30 days (like board links): one that leaked
  // from a forwarded e-mail used to open the report for good. With the
  // columns of 0026 a still-valid link is reused; without them, as before.
  const withKind = await hasLinkKind(admin);
  let existingQ = admin
    .from("share_links")
    .select("token")
    .eq("client_id", access.clientId)
    .eq("revoked", false);
  if (withKind) {
    existingQ = existingQ.eq("kind", "report").gt("expires_at", new Date(Date.now() + 86_400_000).toISOString());
  }
  const { data: existing } = await existingQ
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const token = randomUUID().replace(/-/g, "");
    const { error } = await admin.from("share_links").insert({
      token,
      client_id: access.clientId,
      ...(withKind ? { kind: "report", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() } : {}),
    });
    if (error) {
      // Surface the failure instead of silently doing nothing (usually: the
      // share_links table hasn't been migrated yet).
      redirect(`/${clientSlug}/raport?share=error`);
    }
  }
  revalidatePath(`/${clientSlug}/raport`);
  redirect(`/${clientSlug}/raport?share=ok`);
}

// Server action: revoke every active share link for this client.
async function revokeShareLink(formData: FormData) {
  "use server";
  const clientSlug = String(formData.get("client"));
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const admin = createAdminClient();
  let revokeQ = admin
    .from("share_links")
    .update({ revoked: true })
    .eq("client_id", access.clientId)
    .eq("revoked", false);
  if (await hasLinkKind(admin)) revokeQ = revokeQ.eq("kind", "report");
  await revokeQ;
  revalidatePath(`/${clientSlug}/raport`);
}

// Share box shown to agency users: current public link + create/revoke.
async function ShareBox({
  clientSlug,
  clientId,
  status,
}: {
  clientSlug: string;
  clientId: string;
  status?: string;
}) {
  const admin = createAdminClient();
  const withKind = await hasLinkKind(admin);
  let boxQ = admin
    .from("share_links")
    .select(withKind ? "token, expires_at" : "token")
    .eq("client_id", clientId)
    .eq("revoked", false);
  // The newest still-valid link (several can be active: a legacy one with
  // no expiry next to the 30-day ones that replaced it).
  if (withKind) {
    boxQ = boxQ.eq("kind", "report").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  }
  const { data, error } = await boxQ
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { token?: string; expires_at?: string | null } | null;
  const token = row?.token ?? null;

  // Missing table (migration not run) surfaces as a read error too - tell the
  // user exactly what to do instead of failing silently.
  if (error || status === "error") {
    return (
      <div className="rounded-[22px] bg-warning-soft px-5 py-4 text-sm text-warning print:hidden">
        Publiczne linki wymagają tabeli <code>share_links</code> w Supabase.
        Uruchom migrację <code>0026_share_overview.sql</code> i odśwież stronę.
      </div>
    );
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return (
    <div className="glass flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card px-5 py-4 sm:px-6 print:hidden">
      <span className="flex min-w-0 flex-col">
        <span className="kick">Udostępnij</span>
        <span className="text-sm font-medium">
          Publiczny link do raportu (bez logowania)
          {row?.expires_at ? (
            <span className="font-normal text-ink-3">
              {" "}
              · ważny do{" "}
              {new Date(row.expires_at).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" })}
            </span>
          ) : token ? (
            <span className="font-normal text-ink-3"> · bezterminowy - unieważnij i wygeneruj nowy, ważny 30 dni</span>
          ) : null}
        </span>
      </span>
      {token ? (
        <>
          <input
            readOnly
            value={`${base}/r/${token}`}
            aria-label="Publiczny link do raportu"
            className="h-11 min-w-0 flex-1 basis-56 rounded-full border border-transparent bg-chip px-4 font-mono text-xs text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <ShareCopyButton url={`${base}/r/${token}`} />
          <form action={revokeShareLink}>
            <input type="hidden" name="client" value={clientSlug} />
            <Button
              type="submit"
              variant="ghost"
              size="pill"
              className="text-negative hover:bg-negative-soft hover:text-negative"
            >
              Unieważnij
            </Button>
          </form>
        </>
      ) : (
        <form action={createShareLink}>
          <input type="hidden" name="client" value={clientSlug} />
          <Button type="submit" size="pill">
            Wygeneruj link
          </Button>
        </form>
      )}
    </div>
  );
}

// Platforms in the deck charts take the earthy palette in a fixed order, so
// Meta is the same colour on the donut and the bar list.
const PROVIDER_DECK_COLOR: Record<AdProvider, string> = {
  meta_ads: DECK_COLORS[0],
  google_ads: DECK_COLORS[1],
  tiktok_ads: DECK_COLORS[2],
};

type Direction = "good" | "bad" | "neutral";

// Compact axis/label formatters so chart axes and the donut centre stay short.
const axisPln = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} tys. zł` : `${Math.round(v)} zł`;
const axisNum = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} tys.` : `${Math.round(v)}`;
const compactPln = (minorUnits: number) => {
  const v = minorUnits / 100;
  return v >= 1000
    ? `${(v / 1000).toFixed(1).replace(".", ",")} tys. zł`
    : formatMoneyPLN(minorUnits);
};

function deltaSub(kpi: Kpi, direction: Direction) {
  if (kpi.deltaPercent === null) return { text: "-", tone: "flat" as const };
  const r = Math.round(kpi.deltaPercent * 10) / 10;
  const label = `${r > 0 ? "+" : ""}${formatPercent(r, 1)} vs poprz.`;
  if (direction === "neutral" || r === 0) return { text: label, tone: "flat" as const };
  const good = direction === "good" ? r > 0 : r < 0;
  return { text: label, tone: good ? ("up" as const) : ("down" as const) };
}

export default async function RaportPage({
  params,
  searchParams,
}: {
  params: { clientSlug: string };
  searchParams: {
    range?: string;
    from?: string;
    to?: string;
    month?: string;
    share?: string;
  };
}) {
  // Shared per-request lookups (the layout asks the same questions). The
  // role only matters for the OLX share box, so it doesn't gate the reads:
  // this used to be client -> auth -> role, three trips before any data.
  const viewerPromise = getViewer();
  // Awaited below; this only stops Node flagging an early rejection.
  viewerPromise.catch(() => {});
  const client = await getClientBySlug(params.clientSlug);

  if (!client) {
    redirect("/login");
  }
  const supabase = createClient();

  // OLX gets the agency's SM-template deck (auto-filled monthly report);
  // other clients keep the generic performance deck below.
  if (["olx", "https-www-olx-pl"].includes(params.clientSlug)) {
    const monthParam = searchParams.month;
    const monthDate =
      monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)
        ? new Date(`${monthParam}-15T00:00:00`)
        : undefined;
    const [sm, { isAgency }] = await Promise.all([
      getOlxSmReportData(client.id, client.name, monthDate),
      viewerPromise,
    ]);
    const smFoot = `${client.name} · ${sm.periodLabel} · patoagencja`;

    return (
      <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
        <PageHeader
          className="print:hidden"
          eyebrow={<span className="kick">Raport · {sm.monthLabel}</span>}
          title="Raporty"
          description={`Raport social media ${client.name} za wybrany miesiąc${isAgency ? ", do pobrania jako PPTX" : ""}.`}
          actions={
            <>
              <form method="get" className="flex items-center gap-1.5">
                <input
                  type="month"
                  name="month"
                  defaultValue={monthParam ?? ""}
                  aria-label="Miesiąc raportu"
                  className="h-11 rounded-full border border-transparent bg-chip px-4 text-[15px] text-foreground transition-colors hover:bg-[var(--chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" variant="chip" size="pill">
                  Pokaż
                </Button>
              </form>
              {/* The PPTX route is agency-only; a client clicking it got a 403
                  JSON page. Clients present from the deck below instead. */}
              {isAgency ? (
                <Button asChild size="pill">
                  <a
                    href={`/api/report/pptx?client=${params.clientSlug}${
                      monthParam ? `&month=${monthParam}` : ""
                    }`}
                  >
                    Pobierz PPTX
                  </a>
                </Button>
              ) : null}
            </>
          }
        />

        {isAgency ? (
          <ShareBox
            clientSlug={params.clientSlug}
            clientId={client.id}
            status={searchParams.share}
          />
        ) : null}

        <ReportDeck
          clientSlug={params.clientSlug}
          range="prev_month"
          rangeLabel={sm.monthLabel}
          foot={smFoot}
        >
          {olxSmSlides(sm, smFoot)}
        </ReportDeck>
      </div>
    );
  }

  const range = normalizeRange(searchParams.range);
  const custom = parseCustomRange(searchParams.from, searchParams.to);
  const [data, website, demo, creatives] = await Promise.all([
    loadDashboardData(client.id, range, custom?.start ?? null, custom?.end ?? null),
    getWebsiteData(client.id),
    getDemographics(client.id),
    supabase
      .from("creatives")
      .select("ad_name, thumbnail_url, spend_minor_units, ctr")
      .eq("client_id", client.id)
      .order("spend_minor_units", { ascending: false })
      .limit(4)
      .then((res) => res.data ?? []),
  ]);

  const generatedAt = formatDateWarsaw(new Date(), "d MMM yyyy, HH:mm");
  const periodLabel = `${data.rangeStart} - ${data.rangeEnd}`;
  const foot = `${client.name} · ${periodLabel}`;

  // Per-platform aggregates from the campaign list.
  const platform: Record<AdProvider, { spend: number; clicks: number }> = {
    meta_ads: { spend: 0, clicks: 0 },
    google_ads: { spend: 0, clicks: 0 },
    tiktok_ads: { spend: 0, clicks: 0 },
  };
  for (const c of data.campaigns) {
    platform[c.provider].spend += c.spendMinorUnits;
    platform[c.provider].clicks += c.clicks;
  }
  const activePlatforms = (Object.keys(platform) as AdProvider[]).filter(
    (p) => platform[p].spend > 0
  );

  const topCampaigns = [...data.campaigns]
    .sort((a, b) => b.spendMinorUnits - a.spendMinorUnits)
    .slice(0, 8);

  const k = data.kpis;

  // Source breakdown total (for %), and the true period total from daily rows.
  const totalSessions = website.hasData
    ? website.sources.reduce((s, x) => s + x.sessions, 0)
    : 0;
  // Visits and engagement follow the report's range (the KPI slide shows the
  // same number); getWebsiteData is a fixed last-30-days read, so on "Poprzedni
  // miesiąc" / 90 days this slide used to contradict the KPI slide. Sources,
  // devices, pages and new/returning are 30-day snapshots - labelled as such.
  const sessionsTotal = k.sessions.value;
  const rangeEngagement = data.engagementRate ?? null;

  const genderTotal = demo.gender.reduce((s, g) => s + g.value, 0) || 1;
  const ageTotal = demo.age.reduce((s, a) => s + a.value, 0) || 1;
  const demoSource = (src: "meta" | "ga4" | null) =>
    src === "meta" ? "Wg wyświetleń reklam (Meta)" : "Wg wizyt na stronie (Google Analytics)";

  return (
    <div className="space-y-8 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      {/* Controls (not printed) */}
      <PageHeader
        className="print:hidden"
        eyebrow={<span className="kick">Raport · {data.rangeLabel}</span>}
        title="Raporty"
        description="Wyniki za wybrany okres w formie slajdów - do pokazania na spotkaniu albo pobrania."
        actions={
          <>
            {(await viewerPromise).isAgency ? (
              <Button asChild variant="chip" size="pill">
                <a href={`/api/report/pptx?client=${params.clientSlug}`}>
                  Pobierz PPTX (poprz. miesiąc)
                </a>
              </Button>
            ) : null}
            <DateRangePicker
              value={range}
              customFrom={custom?.start}
              customTo={custom?.end}
            />
          </>
        }
      />

      <ReportDeck
        clientSlug={params.clientSlug}
        range={range}
        rangeLabel={data.rangeLabel}
        foot={foot}
      >
        {/* Cover - MUST stay first (AI summary is injected right after it) */}
        {(() => {
          const Logo = clientLogo(params.clientSlug);
          // The shared client lookup already carries the branding columns
          // (pre-0031 databases: none - the built-in logo / name-only cover),
          // so the deck no longer reads them separately.
          const uploaded = client.logoUrl;
          return (
            <CoverSlide
              title={Logo || uploaded ? "Raport" : `${client.name} - Raport`}
              eyebrow="Kampania online"
              period={periodLabel}
              monogram={client.name.slice(0, 3).toUpperCase()}
              logo={
                uploaded ? (
                  // Uploaded logos are usually drawn for light backgrounds;
                  // a white plate keeps them visible on the dark cover.
                  <span className="flex items-center rounded-lg bg-white px-3 py-1.5">
                    <ClientBrandMark
                      name={client.name}
                      slug={params.clientSlug}
                      logoUrl={uploaded}
                      className="h-7 max-w-[12rem] text-black/85"
                    />
                  </span>
                ) : Logo ? (
                  <Logo className="h-9 w-auto" />
                ) : undefined
              }
            />
          );
        })()}

        {/* ── Section: media data ── */}
        <DividerSlide title="Dane mediowe" subtitle={periodLabel} />

        {/* KPI summary */}
        <ContentSlide
          title="Podsumowanie wyników"
          subtitle={data.rangeLabel}
          section="Dane mediowe"
          foot={foot}
        >
          <div className="grid h-full grid-cols-3 grid-rows-2 gap-4">
            <Stat
              label="Wydatki"
              value={formatMoneyPLN(k.spendMinorUnits.value)}
              {...(() => {
                const d = deltaSub(k.spendMinorUnits, "neutral");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Kliknięcia"
              value={formatNumberPL(k.clicks.value)}
              {...(() => {
                const d = deltaSub(k.clicks, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Wizyty na stronie"
              value={k.sessions.value > 0 ? formatNumberPL(k.sessions.value) : "-"}
              {...(() => {
                const d = deltaSub(k.sessions, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Klikalność (CTR)"
              value={formatPercent(k.ctr.value)}
              {...(() => {
                const d = deltaSub(k.ctr, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Koszt kliknięcia"
              value={formatMoneyPLN(Math.round(k.cpcMinorUnits.value))}
              {...(() => {
                const d = deltaSub(k.cpcMinorUnits, "bad");
                return { sub: d.text, tone: d.tone };
              })()}
            />
            <Stat
              label="Konwersje"
              value={k.conversions.value > 0 ? formatNumberPL(k.conversions.value) : "-"}
              {...(() => {
                const d = deltaSub(k.conversions, "good");
                return { sub: d.text, tone: d.tone };
              })()}
            />
          </div>
        </ContentSlide>

        {/* Platform split */}
        <ContentSlide
          title="Podział wg platform"
          subtitle="Wydatki i kliknięcia: Meta / Google / TikTok"
          section="Dane mediowe"
          foot={foot}
        >
          <div className="grid h-full grid-cols-2 gap-10">
            <div className="flex flex-col">
              <p className="kick mb-3">
                Udział w wydatkach
              </p>
              <div className="min-h-0 flex-1">
                <Donut
                  centerLabel="wydatki"
                  centerValue={compactPln(
                    activePlatforms.reduce((s, p) => s + platform[p].spend, 0)
                  )}
                  items={activePlatforms.map((p) => ({
                    label: AD_PROVIDER_LABEL[p],
                    value: platform[p].spend,
                    display: formatMoneyPLN(platform[p].spend),
                    color: PROVIDER_DECK_COLOR[p],
                  }))}
                />
              </div>
            </div>
            <div>
              <p className="kick mb-3">Kliknięcia</p>
              <BarList
                items={activePlatforms.map((p) => ({
                  label: AD_PROVIDER_LABEL[p],
                  value: platform[p].clicks,
                  display: formatNumberPL(platform[p].clicks),
                  color: PROVIDER_DECK_COLOR[p],
                }))}
              />
            </div>
          </div>
        </ContentSlide>

        {/* Top campaigns */}
        {topCampaigns.length > 0 ? (
          <ContentSlide
            title="Najważniejsze kampanie"
            subtitle="Wg wydatków"
            section="Dane mediowe"
            foot={foot}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  <th className="py-2 pr-3 font-medium">Platforma</th>
                  <th className="py-2 pr-3 font-medium">Kampania</th>
                  <th className="py-2 pr-3 text-right font-medium">Wydatki</th>
                  <th className="py-2 pr-3 text-right font-medium">Kliknięcia</th>
                  <th className="py-2 text-right font-medium">Klikalność</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c) => (
                  <tr
                    key={`${c.provider}:${c.campaignId}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="py-2 pr-3 text-muted-foreground">
                      {AD_PROVIDER_LABEL[c.provider]}
                    </td>
                    <td className="max-w-[22rem] truncate py-2 pr-3" title={c.name}>
                      {c.name}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatMoneyPLN(c.spendMinorUnits)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumberPL(c.clicks)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPercent(c.ctr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ContentSlide>
        ) : null}

        {/* Top creatives */}
        {creatives.length > 0 ? (
          <ContentSlide
            title="Najlepsze reklamy"
            subtitle="Meta - wg wydatków"
            section="Dane mediowe"
            foot={foot}
          >
            <CreativesGrid
              items={creatives.map((c) => ({
                name: (c.ad_name as string) || "Reklama",
                thumbnailUrl: (c.thumbnail_url as string) || null,
                spendDisplay: formatMoneyPLN(Number(c.spend_minor_units)),
                ctrDisplay:
                  c.ctr != null ? formatPercent(Number(c.ctr)) : "-",
              }))}
            />
          </ContentSlide>
        ) : null}

        {/* Trend */}
        <ContentSlide
          title="Trend okresu"
          subtitle="Wydatki a wizyty na stronie"
          section="Dane mediowe"
          foot={foot}
        >
          <div className="flex h-full flex-col">
            <div className="mb-3 flex gap-5 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ background: DECK_COLORS[0] }}
                />
                Wydatki
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ background: DECK_COLORS[1] }}
                />
                Wizyty na stronie (GA4)
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <DualLineChart
                a={{
                  values: data.trend.map((t) => t.spendMinorUnits / 100),
                  color: DECK_COLORS[0],
                  format: axisPln,
                }}
                b={{
                  values: data.trend.map((t) => t.sessions),
                  color: DECK_COLORS[1],
                  format: axisNum,
                }}
              />
            </div>
          </div>
        </ContentSlide>

        {/* ── Section: analytics ── */}
        <DividerSlide title="Dane z Google Analytics" subtitle={periodLabel} />

        {website.hasData ? (
          <>
            {/* Traffic overview */}
            <ContentSlide
              title="Ruch na stronie"
              subtitle={data.rangeLabel}
              section="Dane Analytics"
              foot={foot}
            >
              <div className="grid h-full grid-cols-2 gap-8">
                <div className="grid grid-cols-2 content-start gap-4">
                  <Stat label="Wizyty na stronie" value={formatNumberPL(sessionsTotal)} />
                  <Stat
                    label="Zainteresowani goście"
                    value={
                      rangeEngagement !== null ? formatPercent(rangeEngagement) : "-"
                    }
                  />
                  <Stat
                    label="Nowi (ostatnie 30 dni)"
                    value={formatNumberPL(website.newVsReturning.newUsers)}
                  />
                  <Stat
                    label="Powracający (ostatnie 30 dni)"
                    value={formatNumberPL(website.newVsReturning.returningUsers)}
                  />
                </div>
                <div className="flex flex-col">
                  <p className="kick mb-2">
                    Wizyty na stronie dzień po dniu
                  </p>
                  <div className="min-h-0 flex-1">
                    <LineChart
                      values={data.trend.map((t) => t.sessions)}
                      color={DECK_COLORS[0]}
                      format={axisNum}
                    />
                  </div>
                </div>
              </div>
            </ContentSlide>

            {/* Sources */}
            <ContentSlide
              title="Źródła ruchu"
              subtitle="Wizyty na stronie wg źródła · ostatnie 30 dni"
              section="Dane Analytics"
              foot={foot}
            >
              <BarList
                items={website.sources
                  .slice()
                  .sort((a, b) => b.sessions - a.sessions)
                  .map((s) => ({
                    label: s.category,
                    value: s.sessions,
                    display: `${formatNumberPL(s.sessions)}${
                      totalSessions > 0
                        ? ` (${Math.round((s.sessions / totalSessions) * 100)}%)`
                        : ""
                    }`,
                  }))}
              />
            </ContentSlide>

            {/* Devices + top pages */}
            <ContentSlide
              title="Urządzenia i podstrony"
              subtitle="Ostatnie 30 dni"
              section="Dane Analytics"
              foot={foot}
            >
              <div className="grid h-full grid-cols-2 gap-10">
                <div>
                  <p className="kick mb-3">Urządzenia</p>
                  <BarList
                    items={website.devices
                      .slice()
                      .sort((a, b) => b.sessions - a.sessions)
                      .map((d) => ({
                        label: d.device,
                        value: d.sessions,
                        display: formatNumberPL(d.sessions),
                      }))}
                  />
                </div>
                <div>
                  <p className="kick mb-3">
                    Najczęściej odwiedzane
                  </p>
                  <ol className="space-y-1.5 text-sm">
                    {website.topPages.slice(0, 5).map((p, i) => (
                      <li key={p.path} className="flex gap-2">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span className="flex-1 truncate" title={p.path}>
                          {p.path}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatNumberPL(p.views)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </ContentSlide>
          </>
        ) : (
          <ContentSlide title="Ruch na stronie" section="Dane Analytics" foot={foot}>
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
              Dane z Google Analytics nie są jeszcze dostępne dla tego okresu. Po
              pierwszej synchronizacji pojawią się tu źródła ruchu, urządzenia i
              podstrony.
            </p>
          </ContentSlide>
        )}

        {/* ── Section: demographics ── */}
        {demo.hasData ? (
          <>
            <DividerSlide title="Demografia" subtitle={periodLabel} />

            {demo.gender.length > 0 ? (
              <ContentSlide
                title="Demografia - płeć"
                subtitle={demoSource(demo.genderSource)}
                section="Demografia"
                foot={foot}
              >
                <Donut
                  centerLabel="odbiorcy"
                  items={demo.gender.map((g, i) => ({
                    label: genderLabel(g.bucket),
                    value: g.value,
                    display: `${Math.round((g.value / genderTotal) * 100)}%`,
                    color: DECK_COLORS[i % DECK_COLORS.length],
                  }))}
                />
              </ContentSlide>
            ) : null}

            {demo.age.length > 0 ? (
              <ContentSlide
                title="Demografia - wiek"
                subtitle={demoSource(demo.ageSource)}
                section="Demografia"
                foot={foot}
              >
                <BarList
                  items={demo.age.map((a) => ({
                    label: a.bucket,
                    value: a.value,
                    display: `${Math.round((a.value / ageTotal) * 100)}%`,
                    color: DECK_COLORS[0],
                  }))}
                />
              </ContentSlide>
            ) : null}

            {demo.geo.length > 0 ? (
              <ContentSlide
                title="Geografia"
                subtitle="Wizyty na stronie wg regionu"
                section="Demografia"
                foot={foot}
              >
                <BarList
                  items={demo.geo.map((r) => ({
                    label: regionPL(r.bucket),
                    value: r.value,
                    display: formatNumberPL(r.value),
                  }))}
                />
              </ContentSlide>
            ) : null}
          </>
        ) : null}

        {/* Closing */}
        <DividerSlide
          title="Dziękujemy"
          subtitle={`Przygotowane przez patoagencja · wygenerowano ${generatedAt}`}
        />
      </ReportDeck>
    </div>
  );
}
