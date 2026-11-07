import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdsDayTotals } from "@/lib/dashboard/ads-totals";
import { getClientBranding } from "@/lib/dashboard/branding";
import { plPlural, type StoryFact } from "@/lib/dashboard/story";
import {
  compareMonths,
  ctrPercent,
  historyCovers,
  inMonthPl,
  monthNamePl,
  monthRangePl,
  overlapDays,
  pickBestAd,
  pickBestCampaign,
  previousMonth,
  shortRangePl,
  tidyName,
  type AdMonth,
  type BestBy,
  type CampaignMonth,
  type DigestMonth,
  type MonthChange,
  type MonthChanges,
  type MonthTotals,
} from "@/lib/notify/monthly-digest-core";
import {
  emailLogoUrl,
  esc,
  factsGrid,
  FONT,
  sectionTitle,
} from "@/lib/notify/weekly-digest";
import { fetchAll, fetchAllByDateChunks } from "@/lib/supabase/fetch-all";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";
import { formatNumberPL, formatPercent, formatPlnWhole } from "@/lib/utils";

// "Twój październik w skrócie": the e-mail on the 1st of every month with
// the previous calendar month for the client's marketing team. The weekly
// digest's sibling (lib/notify/weekly-digest.ts) - same recipients, same
// look - and deterministic like it: every sentence is a template filled with
// numbers, no LLM call.
//
// - loadMonthlyDigest(): reads Supabase only (never the ad/GA4 APIs);
// - buildMonthlyDigestEmail(): pure string builder;
// - the date, delta and pick rules live import-free in monthly-digest-core.ts
//   (unit-tested).

// ---- content ----

export interface BestCampaignView {
  provider: string;
  name: string;
  by: BestBy;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  purchases: number;
  sales: number; // grosze
  /** Its share of the month's total on `by` (0-1); null when no other campaign contributed. */
  share: number | null;
}

export interface BestAdView {
  name: string;
  campaignName: string | null;
  by: BestBy;
  spend: number; // grosze
  clicks: number;
  impressions: number;
  purchases: number;
  sales: number; // grosze
  /**
   * The window the numbers cover when it is not the reported month: the
   * Kreacje tab's rolling 30-day snapshot (engagement clients have no
   * ad-level daily rows).
   */
  period: { start: string; end: string } | null;
}

export interface MonthlyDigestContent {
  clientName: string;
  month: DigestMonth;
  /** E-commerce client: sales from ads are shown. Engagement clients never. */
  shop: boolean;
  cur: MonthTotals;
  prev: MonthTotals;
  changes: MonthChanges;
  bestCampaign: BestCampaignView | null;
  bestAd: BestAdView | null;
  /** The panel opened on the reported month. */
  dashboardUrl: string;
  /** "Raporty" for the reported month (every client has the page). */
  reportUrl: string;
  /** The client's own logo (clients.logo_url, https) for the e-mail header. */
  logoUrl?: string | null;
}

// ---- Supabase reads (service-role client: the cron has no session) ----

const num = (v: unknown) => Number(v ?? 0) || 0;
// raw_data.purchase_value is PLN in major units (both ad syncs); grosze here.
const salesOf = (v: unknown) => Math.round(num(v) * 100);

/** First day with any synced row: tells "no history" from "a quiet month". */
async function earliestDay(
  admin: SupabaseClient,
  table: "ads_daily" | "ga4_daily",
  clientId: string
): Promise<string | null> {
  let q = admin.from(table).select("date").eq("client_id", clientId);
  // GA4 daily totals only (every dimension column null), like the panel.
  if (table === "ga4_daily") {
    q = q.is("source_medium", null).is("device_category", null).is("page_path", null);
  }
  const { data } = await q.order("date", { ascending: true }).limit(1).maybeSingle();
  return ((data as { date?: string } | null)?.date as string | undefined) ?? null;
}

async function readSessions(
  admin: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<Array<{ date: string; sessions: number | string }>> {
  return fetchAll<{ date: string; sessions: number | string }>((from, to) =>
    admin
      .from("ga4_daily")
      .select("date, sessions")
      .eq("client_id", clientId)
      .is("source_medium", null)
      .is("device_category", null)
      .is("page_path", null)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}

interface CampaignDayRow {
  provider: string;
  campaign_id: string;
  campaign_name: string | null;
  date: string;
  spend_minor_units: number | string;
  clicks: number | string;
  impressions: number | string;
  purchases?: unknown;
  purchase_value?: unknown;
}

/** ads_daily rows in [start, end]; with `withSales` also the purchase value. */
async function readCampaignDays(
  admin: SupabaseClient,
  clientId: string,
  start: string,
  end: string,
  withSales: boolean
): Promise<CampaignDayRow[]> {
  const columns =
    "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions" +
    (withSales ? ", purchases:raw_data->purchases, purchase_value:raw_data->purchase_value" : "");
  return fetchAllByDateChunks<CampaignDayRow>(start, end, 14, (chunkStart, chunkEnd) =>
    (from, to) =>
      admin
        .from("ads_daily")
        .select(columns)
        .eq("client_id", clientId)
        .gte("date", chunkStart)
        .lte("date", chunkEnd)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: CampaignDayRow[] | null;
        error: { message: string } | null;
      }>
  );
}

/** Per-campaign totals of the month; the name is its latest non-empty one. */
function campaignTotals(rows: CampaignDayRow[], start: string, end: string): CampaignMonth[] {
  const byKey = new Map<string, CampaignMonth>();
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const key = `${r.provider}:${r.campaign_id}`;
    let c = byKey.get(key);
    if (!c) {
      c = {
        provider: r.provider,
        campaignId: r.campaign_id,
        name: r.campaign_id,
        spend: 0,
        clicks: 0,
        impressions: 0,
        purchases: 0,
        sales: 0,
      };
      byKey.set(key, c);
    }
    // Rows come in date order, so the last name seen is the newest.
    if (r.campaign_name) c.name = r.campaign_name;
    c.spend += num(r.spend_minor_units);
    c.clicks += num(r.clicks);
    c.impressions += num(r.impressions);
    c.purchases += num(r.purchases);
    c.sales += salesOf(r.purchase_value);
  }
  return Array.from(byKey.values());
}

/**
 * Shops: ad x day rows with purchases (ads_ad_daily, migration 0039) summed
 * over the month. A missing table or failed read is just "no ad picks".
 */
async function readAdMonth(
  admin: SupabaseClient,
  clientId: string,
  start: string,
  end: string
): Promise<AdMonth[]> {
  type Row = {
    ad_id: string;
    ad_name: string | null;
    campaign_name: string | null;
    date: string;
    spend_minor_units: number | string;
    impressions: number | string;
    clicks: number | string;
    purchases: number | string;
    purchase_value_minor_units: number | string;
  };
  const rows = await fetchAllByDateChunks<Row>(start, end, 7, (chunkStart, chunkEnd) =>
    (from, to) =>
      admin
        .from("ads_ad_daily")
        .select(
          "ad_id, ad_name, campaign_name, date, spend_minor_units, impressions, clicks, purchases, purchase_value_minor_units"
        )
        .eq("client_id", clientId)
        .gte("date", chunkStart)
        .lte("date", chunkEnd)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("ad_id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: Row[] | null;
        error: { message: string } | null;
      }>
  );
  const byAd = new Map<string, AdMonth>();
  for (const r of rows) {
    let a = byAd.get(r.ad_id);
    if (!a) {
      a = {
        adId: r.ad_id,
        name: r.ad_id,
        campaignName: null,
        spend: 0,
        clicks: 0,
        impressions: 0,
        purchases: 0,
        sales: 0,
      };
      byAd.set(r.ad_id, a);
    }
    if (r.ad_name) a.name = r.ad_name;
    if (r.campaign_name) a.campaignName = r.campaign_name;
    a.spend += num(r.spend_minor_units);
    a.clicks += num(r.clicks);
    a.impressions += num(r.impressions);
    a.purchases += num(r.purchases);
    a.sales += num(r.purchase_value_minor_units);
  }
  return Array.from(byAd.values());
}

/**
 * The Kreacje tab's per-ad snapshot (Meta, rolling 30 days, refreshed every
 * few hours). Only rows whose window covers most of the reported month: an
 * ad switched off in summer keeps its summer numbers here, and the preview
 * can run late in the month when the snapshot is mostly the new month.
 */
async function readCreativesSnapshot(
  admin: SupabaseClient,
  clientId: string,
  month: DigestMonth
): Promise<Array<AdMonth & { periodStart: string; periodEnd: string }>> {
  // "*" like the Kreacje page: naming a column of a later migration
  // (campaign_name, 0039) would fail the whole read on an older database.
  const { data, error } = await admin
    .from("creatives")
    .select("*")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(300);
  if (error) return [];
  const minOverlap = Math.ceil(month.days / 2);
  const out: Array<AdMonth & { periodStart: string; periodEnd: string }> = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const periodStart = typeof r.period_start === "string" ? r.period_start.slice(0, 10) : null;
    const periodEnd = typeof r.period_end === "string" ? r.period_end.slice(0, 10) : null;
    if (!periodStart || !periodEnd) continue;
    if (overlapDays(month.start, month.end, periodStart, periodEnd) < minOverlap) continue;
    out.push({
      adId: String(r.ad_id),
      name: (r.ad_name as string | null) || String(r.ad_id),
      campaignName: (r.campaign_name as string | null | undefined) ?? null,
      spend: num(r.spend_minor_units),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      purchases: 0,
      sales: 0,
      periodStart,
      periodEnd,
    });
  }
  return out;
}

async function loadBestAd(
  admin: SupabaseClient,
  clientId: string,
  month: DigestMonth,
  shop: boolean
): Promise<BestAdView | null> {
  const view = (a: AdMonth, by: BestBy, period: BestAdView["period"]): BestAdView => ({
    name: a.name,
    campaignName: a.campaignName,
    by,
    spend: a.spend,
    clicks: a.clicks,
    impressions: a.impressions,
    purchases: a.purchases,
    sales: a.sales,
    period,
  });

  // Shops: the exact month from ad-level daily rows, judged on sales.
  if (shop) {
    const ads = await readAdMonth(admin, clientId, month.start, month.end).catch(() => []);
    const pick = pickBestAd(ads, true);
    if (pick) return view(pick.ad, pick.by, null);
  }
  const snapshot = await readCreativesSnapshot(admin, clientId, month).catch(() => []);
  const pick = pickBestAd(snapshot, false);
  if (!pick) return null;
  const chosen = snapshot.find((s) => s.adId === pick.ad.adId);
  const period =
    chosen && (chosen.periodStart !== month.start || chosen.periodEnd !== month.end)
      ? { start: chosen.periodStart, end: chosen.periodEnd }
      : null;
  return view(pick.ad, pick.by, period);
}

const emptyTotals = (): MonthTotals => ({
  spend: 0,
  clicks: 0,
  impressions: 0,
  sessions: 0,
  sales: 0,
  purchases: 0,
});

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Everything the digest needs for one client and the last complete month
 * before `today` (Warsaw yyyy-MM-dd). Returns null when that month has no
 * data at all - an empty e-mail would only look like a bug.
 */
export async function loadMonthlyDigest(
  admin: SupabaseClient,
  client: { id: string; name: string; slug: string; ecommerce: boolean },
  today: string,
  appUrl: string
): Promise<MonthlyDigestContent | null> {
  const month = previousMonth(today);
  const shop = client.ecommerce;

  const [adsEarliest, ga4Earliest, adDays, sessionRows, campaignRows] = await Promise.all([
    earliestDay(admin, "ads_daily", client.id),
    earliestDay(admin, "ga4_daily", client.id),
    getAdsDayTotals(admin, client.id, month.prevStart, month.end),
    readSessions(admin, client.id, month.prevStart, month.end),
    // Engagement clients never get revenue: their purchase values aren't
    // even read. Shops need last month's too, for the sales comparison.
    readCampaignDays(admin, client.id, shop ? month.prevStart : month.start, month.end, shop),
  ]);

  const cur = emptyTotals();
  const prev = emptyTotals();
  const bucket = (date: string) =>
    date >= month.start && date <= month.end
      ? cur
      : date >= month.prevStart && date <= month.prevEnd
        ? prev
        : null;
  for (const d of adDays) {
    const t = bucket(d.date);
    if (!t) continue;
    t.spend += d.spend;
    t.clicks += d.clicks;
    t.impressions += d.impressions;
  }
  for (const r of sessionRows) {
    const t = bucket(r.date);
    if (t) t.sessions += num(r.sessions);
  }
  if (shop) {
    for (const r of campaignRows) {
      const t = bucket(r.date);
      if (!t) continue;
      t.sales += salesOf(r.purchase_value);
      t.purchases += num(r.purchases);
    }
  }

  if (cur.spend === 0 && cur.clicks === 0 && cur.sessions === 0) return null;

  const changes = compareMonths(cur, prev, month, {
    ads: historyCovers(adsEarliest, month.prevStart),
    ga4: historyCovers(ga4Earliest, month.prevStart),
  });

  const campaigns = campaignTotals(campaignRows, month.start, month.end);
  const best = pickBestCampaign(campaigns, shop);
  let bestCampaign: BestCampaignView | null = null;
  if (best) {
    const metric = (c: CampaignMonth) => (best.by === "sales" ? c.sales : c.clicks);
    const total = campaigns.reduce((s, c) => s + metric(c), 0);
    // "100% wszystkich kliknięć" says nothing: a share only among several.
    const contributing = campaigns.filter((c) => metric(c) > 0).length;
    const c = best.campaign;
    bestCampaign = {
      provider: c.provider,
      name: c.name,
      by: best.by,
      spend: c.spend,
      clicks: c.clicks,
      impressions: c.impressions,
      purchases: c.purchases,
      sales: c.sales,
      share: contributing > 1 && total > 0 ? metric(c) / total : null,
    };
  }

  const [bestAd, branding] = await Promise.all([
    loadBestAd(admin, client.id, month, shop),
    // Pre-0031 databases (or a failed read) just send the name-only header.
    getClientBranding(admin, client.id).catch(() => null),
  ]);

  const base = `${appUrl.replace(/\/+$/, "")}/${client.slug}`;
  const range = `from=${month.start}&to=${month.end}`;
  return {
    clientName: client.name,
    month,
    shop,
    cur,
    prev,
    changes,
    bestCampaign,
    bestAd,
    // The panel on exactly the month the e-mail describes (same totals),
    // like the weekly digest's link.
    dashboardUrl: `${base}?${range}`,
    // The generic deck reads from/to, OLX's monthly deck reads month=YYYY-MM;
    // each ignores the other's parameter.
    reportUrl: `${base}/raport?${range}&month=${month.year}-${pad2(month.month)}`,
    logoUrl: branding?.logoUrl ?? null,
  };
}

// ---- wording ----

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clicksWord = (n: number) => plPlural(n, "kliknięcie", "kliknięcia", "kliknięć");
const ordersWord = (n: number) => plPlural(n, "zamówienie", "zamówienia", "zamówień");

/** One sentence, the inbox preview line too. */
export function monthlyHeadline(c: MonthlyDigestContent): string {
  const when = cap(inMonthPl(c.month.month));
  const { spend, clicks, sessions, sales } = c.cur;
  if (c.shop && sales > 0) {
    return `${when} reklamy przyniosły ${formatPlnWhole(sales)} sprzedaży (wg Meta i Google)${
      spend > 0 ? ` przy wydatkach na reklamy ${formatPlnWhole(spend)}` : ""
    }.`;
  }
  const clicksText = `${formatNumberPL(clicks)} ${clicksWord(clicks)}`;
  const visitsText = `${formatNumberPL(sessions)} ${plPlural(sessions, "wizytę", "wizyty", "wizyt")}`;
  // "Za 8 450 zł reklamy przyciągnęły..." answers "ile wydaliśmy i co mamy".
  const forMoney = spend > 0 ? `za ${formatPlnWhole(spend)} reklamy` : "reklamy";
  // Sessions are ALL GA4 visits, not only the ones ads brought (story.ts).
  if (clicks > 0 && sessions > 0) {
    return `${when} ${forMoney} przyciągnęły ${clicksText}, a strona miała łącznie ${visitsText}.`;
  }
  if (clicks > 0) return `${when} ${forMoney} przyciągnęły ${clicksText}.`;
  if (sessions > 0) return `${when} strona miała ${visitsText}.`;
  return `${when} na reklamy wydano ${formatPlnWhole(spend)}.`;
}

const asChange = (m: MonthChange | null) => (m ? { text: m.text, tone: m.tone } : null);

/** Up to four tiles, in the weekly digest's StoryFact shape. */
export function monthlyFacts(c: MonthlyDigestContent): StoryFact[] {
  const { cur, changes } = c;
  const showSales = c.shop && cur.sales > 0;
  const facts: StoryFact[] = [];
  if (showSales) {
    facts.push({
      key: "sales",
      value: formatPlnWhole(cur.sales),
      caption: "sprzedaży z reklam (wg Meta i Google)",
      change: asChange(changes.sales),
    });
  }
  if (cur.spend > 0) {
    facts.push({
      key: "spend",
      value: formatPlnWhole(cur.spend),
      caption: "wydane na reklamy",
      change: asChange(changes.spend),
    });
  }
  if (cur.clicks > 0) {
    facts.push({
      key: "clicks",
      value: formatNumberPL(cur.clicks),
      caption: `${clicksWord(cur.clicks)} w reklamy`,
      change: asChange(changes.clicks),
    });
  }
  if (cur.sessions > 0) {
    facts.push({
      key: "sessions",
      value: formatNumberPL(cur.sessions),
      caption: `${plPlural(cur.sessions, "wizyta", "wizyty", "wizyt")} na stronie`,
      change: asChange(changes.sessions),
    });
  }
  // A shop's fourth tile is its sales; everyone else gets the CTR the
  // dashboard's KPI row shows.
  if (!showSales && cur.clicks > 0 && cur.impressions > 0) {
    facts.push({
      key: "ctr",
      value: formatPercent(ctrPercent(cur.clicks, cur.impressions), 2),
      caption: "klikalność reklam (CTR)",
      change: asChange(changes.ctr),
    });
  }
  return facts.slice(0, 4);
}

function campaignLines(b: BestCampaignView, monthIdx: number): { metrics: string; reason: string } {
  const spend = b.spend > 0 ? ` · ${formatPlnWhole(b.spend)} wydatków` : "";
  const share = (what: string) =>
    b.share !== null ? ` - ${Math.round(b.share * 100)}% ${what}` : "";
  if (b.by === "sales") {
    const orders = Math.round(b.purchases);
    return {
      metrics: `${formatPlnWhole(b.sales)} sprzedaży${
        orders > 0 ? ` · ${formatNumberPL(orders)} ${ordersWord(orders)}` : ""
      }${spend}`,
      reason: `Najwięcej sprzedaży z reklam ${inMonthPl(monthIdx)}${share("całej sprzedaży z reklam")}.`,
    };
  }
  return {
    metrics: `${formatNumberPL(b.clicks)} ${clicksWord(b.clicks)} · CTR ${formatPercent(
      ctrPercent(b.clicks, b.impressions),
      2
    )}${spend}`,
    reason: `Najwięcej kliknięć ${inMonthPl(monthIdx)}${share("wszystkich kliknięć w reklamy")}.`,
  };
}

function adLines(a: BestAdView): { metrics: string; reason: string } {
  if (a.by === "sales") {
    const orders = Math.round(a.purchases);
    return {
      metrics: `${formatPlnWhole(a.sales)} sprzedaży${
        orders > 0 ? ` · ${formatNumberPL(orders)} ${ordersWord(orders)}` : ""
      }${a.spend > 0 ? ` · ${formatPlnWhole(a.spend)} wydatków` : ""}`,
      reason: "Przyniosła najwięcej sprzedaży.",
    };
  }
  return {
    metrics: `CTR ${formatPercent(ctrPercent(a.clicks, a.impressions), 2)} · ${formatNumberPL(
      a.clicks
    )} ${clicksWord(a.clicks)} · ${formatNumberPL(a.impressions)} ${plPlural(
      a.impressions,
      "wyświetlenie",
      "wyświetlenia",
      "wyświetleń"
    )}`,
    reason: "Najczęściej klikana z Twoich reklam.",
  };
}

// ---- pure HTML builder ----

function pickCard(icon: string, kicker: string, name: string, lines: string[], reason: string): string {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px">
        <tr>
          <td width="56" valign="top" style="padding:16px 0 16px 16px">
            <div style="width:40px;height:40px;border-radius:12px;background:#eef2ff;text-align:center;line-height:40px;font-size:20px">${icon}</div>
          </td>
          <td valign="top" style="padding:16px 16px 16px 12px">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#64748b">${esc(kicker)}</div>
            <div style="margin-top:4px;font-size:15px;line-height:1.4;font-weight:700;color:#0f172a;word-break:break-word">${esc(name)}</div>
            ${lines
              .map(
                (l) =>
                  `<div style="margin-top:6px;font-size:13px;line-height:1.5;color:#475569">${esc(l)}</div>`
              )
              .join("")}
            <div style="margin-top:6px;font-size:13px;line-height:1.5;font-weight:600;color:#15803d">${esc(reason)}</div>
          </td>
        </tr>
      </table>`;
}

const providerLabel = (p: string) => AD_PROVIDER_LABEL[p as AdProvider] ?? p;

export interface MonthlyDigestEmail {
  subject: string;
  /** Hidden inbox preview line. */
  preheader: string;
  html: string;
  /** Plain-text part (spam filters and text-only clients like having one). */
  text: string;
}

export function buildMonthlyDigestEmail(c: MonthlyDigestContent): MonthlyDigestEmail {
  const m = c.month;
  const name = monthNamePl(m.month);
  const kicker = `Twój ${name} w skrócie`;
  const subject = `${kicker} · ${c.clientName}`;
  const range = monthRangePl(m);
  const headline = monthlyHeadline(c);
  const preheader = headline;
  const facts = monthlyFacts(c);

  const section = (inner: string, top = 28) =>
    `<tr><td class="px" style="padding:${top}px 32px 0">${inner}</td></tr>`;

  const camp = c.bestCampaign ? campaignLines(c.bestCampaign, m.month) : null;
  const campaignHtml =
    c.bestCampaign && camp
      ? section(
          `${sectionTitle("Najlepsza kampania")}${pickCard(
            "📣",
            providerLabel(c.bestCampaign.provider),
            tidyName(c.bestCampaign.name),
            [camp.metrics],
            camp.reason
          )}`
        )
      : "";

  const ad = c.bestAd ? adLines(c.bestAd) : null;
  const adKicker = c.bestAd
    ? `Meta${c.bestAd.period ? ` · dane z 30 dni: ${shortRangePl(c.bestAd.period.start, c.bestAd.period.end)}` : ""}`
    : "";
  const adHtml =
    c.bestAd && ad
      ? section(
          `${sectionTitle("Najlepsza reklama")}${pickCard(
            "🎨",
            adKicker,
            tidyName(c.bestAd.name),
            [
              ad.metrics,
              ...(c.bestAd.campaignName ? [`Kampania: ${tidyName(c.bestAd.campaignName, 60)}`] : []),
            ],
            ad.reason
          )}`
        )
      : "";

  // What the % compare with, and how - managers ask "wcześniej, czyli kiedy?".
  const anyChange = facts.some((f) => f.change);
  const prevLabel = `${monthNamePl(m.prevMonth)} ${m.prevYear}`;
  const notes = [
    anyChange ? `Porównanie z poprzednim miesiącem (${prevLabel}).` : "",
    anyChange && m.days !== m.prevDays
      ? "Miesiące mają różną liczbę dni, więc porównujemy średnie dzienne."
      : "",
    "Dane z kont reklamowych i Google Analytics 4.",
    c.cur.sessions > 0 ? "Wizyty to cały ruch na stronie, nie tylko z reklam." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const reportUrl = esc(c.reportUrl);
  const dashboardUrl = esc(c.dashboardUrl);
  const logo = emailLogoUrl(c.logoUrl);
  // Same header as the weekly digest: a white strip for the client's logo
  // (usually made for light backgrounds) above the coloured hero.
  const logoRow = logo
    ? `<tr>
          <td class="px" style="padding:20px 32px;background:#ffffff;border-bottom:1px solid #e2e8f0">
            <img src="${esc(logo)}" alt="${esc(c.clientName)}" width="160" height="40" style="display:block;width:auto;max-width:200px;height:40px;border:0;outline:none;text-decoration:none">
          </td>
        </tr>`
    : "";
  // Preheader padding stops clients from pulling body text into the preview.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(60);

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  @media only screen and (max-width:480px) {
    .px { padding-left:20px !important; padding-right:20px !important; }
    .hero { padding:28px 20px 26px !important; }
    .headline { font-size:20px !important; }
    .gridwrap { padding-left:12px !important; padding-right:12px !important; }
    .grid { border-spacing:8px !important; }
    .tile { padding:14px 12px 16px !important; }
    .fact-value { font-size:24px !important; }
    .outer { padding:12px 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f1f5f9">
  <tr>
    <td class="outer" align="center" style="padding:32px 12px;font-family:${FONT}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden">
        ${logoRow}
        <tr>
          <td class="hero" style="background:#4f46e5;background-image:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:34px 32px 30px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#e0e7ff">${esc(kicker)}</div>
            <div style="margin-top:8px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.4px;color:#ffffff">${esc(c.clientName)}</div>
            <div style="margin-top:6px;font-size:14px;color:#e0e7ff">${esc(range)}</div>
          </td>
        </tr>
        ${section(
          `<div class="headline" style="font-size:22px;line-height:1.4;font-weight:700;color:#0f172a;letter-spacing:-0.2px">${esc(headline)}</div>`,
          30
        )}
        ${facts.length ? `<tr><td class="gridwrap" style="padding:18px 22px 0">${factsGrid(facts)}</td></tr>` : ""}
        ${campaignHtml}
        ${adHtml}
        <tr>
          <td class="px" align="center" style="padding:34px 32px 8px">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate">
              <tr>
                <td align="center" style="border-radius:12px;background:#4f46e5">
                  <a href="${reportUrl}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">Otwórz raport za ${esc(name)}&nbsp;&rarr;</a>
                </td>
              </tr>
            </table>
            <div style="margin-top:12px;font-size:13px;color:#64748b">albo <a href="${dashboardUrl}" target="_blank" style="color:#4f46e5;font-weight:600;text-decoration:underline">zobacz ${esc(name)} w panelu</a> - wykresy, kampanie i ruch na stronie</div>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:28px 32px 26px">
            <div style="border-top:1px solid #f1f5f9;padding-top:18px;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center">
              ${esc(notes)}<br>
              Wysyłane automatycznie 1. dnia każdego miesiąca przez panel · patoagencja<br>
              Nie chcesz dostawać tego podsumowania? Daj znać swojemu opiekunowi w agencji.
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textLines = [
    subject,
    range,
    "",
    headline,
    "",
    ...facts.map((f) => `- ${f.value} ${f.caption}${f.change ? ` - ${f.change.text}` : ""}`),
    ...(c.bestCampaign && camp
      ? [
          "",
          `Najlepsza kampania (${providerLabel(c.bestCampaign.provider)}): ${tidyName(c.bestCampaign.name)}`,
          `${camp.metrics}. ${camp.reason}`,
        ]
      : []),
    ...(c.bestAd && ad
      ? ["", `Najlepsza reklama (${adKicker}): ${tidyName(c.bestAd.name)}`, `${ad.metrics}. ${ad.reason}`]
      : []),
    "",
    `Raport za ${name}: ${c.reportUrl}`,
    `Panel: ${c.dashboardUrl}`,
    "",
    notes,
    "Wysyłane automatycznie 1. dnia każdego miesiąca przez panel · patoagencja",
  ];
  // Formatters use non-breaking spaces; plain text reads better with normal ones.
  const text = textLines.join("\n").replace(/ /g, " ");

  return { subject, preheader, html, text };
}
