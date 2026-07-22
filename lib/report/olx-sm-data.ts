import Anthropic from "@anthropic-ai/sdk";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

import { createAdminClient } from "@/lib/supabase/admin";
import type { AdProvider } from "@/lib/types";

// Data assembly for the monthly OLX Social Media PPTX report. Aggregates
// ads_daily per channel for the target month (+2 prior months for the
// lookback), pulls top creatives, and asks Claude for the narrative sections
// (deep dive flags, learnings, recommendations). Money in grosze.

export interface ChannelMonth {
  provider: AdProvider;
  cost: number; // grosze
  impressions: number;
  clicks: number;
  reach: number; // summed daily reach (no dedup)
  cpc: number | null; // grosze
  cpm: number | null; // grosze per 1000
  frequency: number | null;
}

export interface LookbackRow {
  provider: AdProvider;
  months: Array<{ label: string; cpm: number | null; reach: number }>;
}

export interface CreativeCell {
  name: string;
  metricLabel: string;
  metricValue: string;
  thumbnailUrl: string | null;
}

export interface AiSections {
  metaFlag: string;
  metaBullets: string[];
  tiktokFlag: string;
  tiktokBullets: string[];
  categoriesFlag: string;
  categoriesBullets: string[];
  learnings: string[]; // 3
  recommendations: Array<{ text: string; priority: "HIGH" | "MED" | "LOW" }>;
  mainLearnings: string[]; // 3 short (AI block)
  flagAnomaly: string;
  trendVsPrev: string;
  questions: string;
}

export interface OlxSmReportData {
  clientName: string;
  periodLabel: string; // 01.06.2026-30.06.2026
  monthLabel: string; // Czerwiec 2026
  monthCode: string; // JUN_2026
  channels: ChannelMonth[];
  totalCost: number;
  totalReach: number;
  bestCpm: { provider: AdProvider; cpm: number } | null;
  topFrequency: { provider: AdProvider; frequency: number } | null;
  lookback: LookbackRow[];
  topCampaignNames: Array<{ provider: AdProvider; name: string; cost: number }>;
  namingSegments: Array<{ segment: string; value: string }>;
  creativesReach: CreativeCell[]; // Meta top by spend (proxy for reach focus)
  creativesTraffic: CreativeCell[]; // Meta top by clicks
  ai: AiSections;
}

const MONTHS_PL = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];
const MONTH_CODES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export const plnFmt = (grosze: number) =>
  `${(grosze / 100).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN`;
export const numFmt = (n: number) => n.toLocaleString("pl-PL");

/** Compact number: 62,1 mln / 328,4 tys. */
export const numCompact = (n: number) => {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} mln`;
  if (n >= 10_000)
    return `${(n / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} tys.`;
  return numFmt(n);
};

interface Agg {
  cost: number;
  impressions: number;
  clicks: number;
  reach: number;
}
const emptyAgg = (): Agg => ({ cost: 0, impressions: 0, clicks: 0, reach: 0 });

function channelFromAgg(provider: AdProvider, a: Agg): ChannelMonth {
  return {
    provider,
    cost: a.cost,
    impressions: a.impressions,
    clicks: a.clicks,
    reach: a.reach,
    cpc: a.clicks > 0 ? a.cost / a.clicks : null,
    cpm: a.impressions > 0 ? (a.cost / a.impressions) * 1000 : null,
    frequency: a.reach > 0 ? a.impressions / a.reach : null,
  };
}

/** Parse "OLX-PL | BRAND | GOODS | CEP | REACH | ... " into naming segments. */
function parseNaming(name: string): Array<{ segment: string; value: string }> {
  // Campaign names use either " | " (new convention) or " / " (legacy [FP]
  // names) as the segment separator - support both.
  const sep = name.includes("|") ? "|" : "/";
  const parts = name.split(sep).map((p) => p.trim()).filter(Boolean);
  const labels = [
    "PREFIX", "BRAND", "PILAR", "TYP", "CEL", "Opis", "Wersja", "Okres", "Kanał", "Agencja",
  ];
  return parts.map((value, i) => ({
    segment: labels[i] ?? `Segment ${i + 1}`,
    value,
  }));
}

/** Compact PLN for tight stat cards: 531,4 tys. / 1,42 mln. */
export const plnCompact = (grosze: number) => {
  const zl = grosze / 100;
  if (zl >= 1_000_000)
    return `${(zl / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} mln PLN`;
  if (zl >= 10_000)
    return `${(zl / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} tys. PLN`;
  return plnFmt(grosze);
};

async function generateAiSections(
  monthLabel: string,
  channels: ChannelMonth[],
  lookback: LookbackRow[],
  topCampaigns: Array<{ provider: AdProvider; name: string; cost: number }>
): Promise<AiSections> {
  const fallback: AiSections = {
    metaFlag: "OK - brak anomalii",
    metaBullets: ["Dane zebrane automatycznie - analiza w przygotowaniu."],
    tiktokFlag: "OK - brak anomalii",
    tiktokBullets: ["Dane zebrane automatycznie - analiza w przygotowaniu."],
    categoriesFlag: "OK - brak anomalii",
    categoriesBullets: ["Dane zebrane automatycznie - analiza w przygotowaniu."],
    learnings: ["-", "-", "-"],
    recommendations: [
      { text: "-", priority: "MED" },
      { text: "-", priority: "MED" },
      { text: "-", priority: "MED" },
    ],
    mainLearnings: ["-", "-", "-"],
    flagAnomaly: "-",
    trendVsPrev: "-",
    questions: "-",
  };

  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const channelLines = channels.map(
    (c) =>
      `${c.provider}: koszt ${plnFmt(c.cost)}, impr ${numFmt(c.impressions)}, clicks ${numFmt(
        c.clicks
      )}, reach ${numFmt(c.reach)}, CPC ${c.cpc ? plnFmt(Math.round(c.cpc)) : "-"}, CPM ${
        c.cpm ? plnFmt(Math.round(c.cpm)) : "-"
      }, freq ${c.frequency?.toFixed(2) ?? "-"}`
  );
  const lookbackLines = lookback.map(
    (l) =>
      `${l.provider}: ${l.months
        .map((m) => `${m.label} CPM ${m.cpm ? plnFmt(Math.round(m.cpm)) : "-"} reach ${numFmt(m.reach)}`)
        .join(" | ")}`
  );
  const campaignLines = topCampaigns
    .slice(0, 6)
    .map((c) => `${c.provider}: ${c.name} (${plnFmt(c.cost)})`);

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1600,
      system:
        "Jesteś strategiem social media agencji patoagencja przygotowującym miesięczny raport dla OLX. Klient brandowy (reach/traffic, NIE e-commerce, nigdy ROAS). Odpowiadasz WYŁĄCZNIE poprawnym JSON, po polsku, zwięźle, bez emoji. Nie używaj długich myślników.",
      messages: [
        {
          role: "user",
          content: `Dane kampanii OLX za ${monthLabel}:\nKANAŁY:\n${channelLines.join(
            "\n"
          )}\nLOOKBACK 3M:\n${lookbackLines.join("\n")}\nTOP KAMPANIE:\n${campaignLines.join(
            "\n"
          )}\n\nZwróć JSON:\n{"metaFlag":"OK|WATCH|ALERT - krótki powód","metaBullets":["3-5 punktów analizy Meta"],"tiktokFlag":"...","tiktokBullets":["..."],"categoriesFlag":"...","categoriesBullets":["3-4 punkty o kampaniach/kategoriach"],"learnings":["3 kluczowe wnioski"],"recommendations":[{"text":"konkretna rekomendacja","priority":"HIGH|MED|LOW"} x3],"mainLearnings":["3 wnioski max 80 znaków"],"flagAnomaly":"najważniejsza anomalia albo 'brak'","trendVsPrev":"trend vs poprzedni miesiąc w 1 zdaniu","questions":"2-3 pytania/decyzje dla OLX w 1 linii"}`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { ...fallback, ...json };
  } catch (err) {
    console.error("[olx-sm-report] AI sections failed", err);
    return fallback;
  }
}

/**
 * Assemble everything the OLX SM monthly deck needs for the month containing
 * `monthDate` (defaults to the previous calendar month).
 */
export async function getOlxSmReportData(
  clientId: string,
  clientName: string,
  monthDate?: Date
): Promise<OlxSmReportData> {
  const admin = createAdminClient();

  const target = monthDate ?? subMonths(new Date(), 1);
  const monthStart = startOfMonth(target);
  const monthEnd = endOfMonth(target);
  const fetchStart = startOfMonth(subMonths(target, 2)); // 3-month lookback

  const fmtIso = (d: Date) => format(d, "yyyy-MM-dd");
  const fmtDot = (d: Date) => format(d, "dd.MM.yyyy");

  const { data: rows } = await admin
    .from("ads_daily")
    .select("provider, campaign_id, campaign_name, date, spend_minor_units, impressions, clicks, reach")
    .eq("client_id", clientId)
    .gte("date", fmtIso(fetchStart))
    .lte("date", fmtIso(monthEnd));

  // Aggregate per provider per month-bucket, and per campaign for the target month.
  const monthKey = (d: string) => d.slice(0, 7); // yyyy-MM
  const targetKey = format(monthStart, "yyyy-MM");
  const byProviderMonth = new Map<string, Agg>();
  const byCampaign = new Map<string, { provider: AdProvider; name: string; cost: number }>();

  for (const r of rows ?? []) {
    const key = `${r.provider}:${monthKey(r.date as string)}`;
    const agg = byProviderMonth.get(key) ?? emptyAgg();
    agg.cost += Number(r.spend_minor_units);
    agg.impressions += Number(r.impressions);
    agg.clicks += Number(r.clicks);
    agg.reach += Number(r.reach ?? 0);
    byProviderMonth.set(key, agg);

    if (monthKey(r.date as string) === targetKey) {
      const ck = `${r.provider}:${r.campaign_id}`;
      const c =
        byCampaign.get(ck) ??
        {
          provider: r.provider as AdProvider,
          name: (r.campaign_name as string) || (r.campaign_id as string),
          cost: 0,
        };
      c.cost += Number(r.spend_minor_units);
      byCampaign.set(ck, c);
    }
  }

  const providers: AdProvider[] = ["meta_ads", "tiktok_ads", "google_ads"];
  const channels: ChannelMonth[] = providers
    .map((p) => {
      const agg = byProviderMonth.get(`${p}:${targetKey}`);
      return agg ? channelFromAgg(p, agg) : null;
    })
    .filter((c): c is ChannelMonth => c !== null && c.cost > 0);

  const lookbackMonths = [subMonths(monthStart, 2), subMonths(monthStart, 1), monthStart];
  const lookback: LookbackRow[] = channels.map((c) => ({
    provider: c.provider,
    months: lookbackMonths.map((m) => {
      const agg = byProviderMonth.get(`${c.provider}:${format(m, "yyyy-MM")}`);
      return {
        label: MONTHS_PL[m.getMonth()],
        cpm:
          agg && agg.impressions > 0 ? (agg.cost / agg.impressions) * 1000 : null,
        reach: agg?.reach ?? 0,
      };
    }),
  }));

  const topCampaignNames = Array.from(byCampaign.values())
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  const totalCost = channels.reduce((s, c) => s + c.cost, 0);
  const totalReach = channels.reduce((s, c) => s + c.reach, 0);
  const withCpm = channels.filter((c) => c.cpm !== null);
  const bestCpm = withCpm.length
    ? withCpm.reduce((m, c) => (c.cpm! < m.cpm! ? c : m))
    : null;
  const withFreq = channels.filter((c) => c.frequency !== null);
  const topFrequency = withFreq.length
    ? withFreq.reduce((m, c) => (c.frequency! > m.frequency! ? c : m))
    : null;

  // Creatives (Meta only in the creatives table today).
  const { data: creativeRows } = await admin
    .from("creatives")
    .select("ad_name, thumbnail_url, spend_minor_units, clicks, impressions, ctr")
    .eq("client_id", clientId)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(12);

  const creatives = creativeRows ?? [];
  const creativesReach: CreativeCell[] = creatives.slice(0, 3).map((c) => ({
    name: (c.ad_name as string) || "(bez nazwy)",
    metricLabel: "Wyświetlenia",
    metricValue: numFmt(Number(c.impressions ?? 0)),
    thumbnailUrl: (c.thumbnail_url as string) ?? null,
  }));
  const creativesTraffic: CreativeCell[] = [...creatives]
    .sort((a, b) => Number(b.clicks ?? 0) - Number(a.clicks ?? 0))
    .slice(0, 3)
    .map((c) => ({
      name: (c.ad_name as string) || "(bez nazwy)",
      metricLabel: "Kliknięcia",
      metricValue: numFmt(Number(c.clicks ?? 0)),
      thumbnailUrl: (c.thumbnail_url as string) ?? null,
    }));

  const namingSegments = topCampaignNames.length
    ? parseNaming(topCampaignNames[0].name)
    : [];

  // AI sections are cached per client+month (report_cache) so viewing the
  // report tab doesn't re-run the LLM. Cache errors (e.g. table not yet
  // migrated) degrade to generating fresh each time.
  const cacheKey = `olx-sm-ai:${targetKey}`;
  let ai: AiSections | null = null;
  try {
    const { data: cached } = await admin
      .from("report_cache")
      .select("payload")
      .eq("client_id", clientId)
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached?.payload) ai = cached.payload as unknown as AiSections;
  } catch {
    // table missing - ignore
  }
  if (!ai) {
    ai = await generateAiSections(
      `${MONTHS_PL[monthStart.getMonth()]} ${monthStart.getFullYear()}`,
      channels,
      lookback,
      topCampaignNames
    );
    try {
      await admin.from("report_cache").upsert(
        {
          client_id: clientId,
          cache_key: cacheKey,
          payload: ai as unknown as Record<string, unknown>,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,cache_key" }
      );
    } catch {
      // table missing - ignore
    }
  }

  return {
    clientName,
    periodLabel: `${fmtDot(monthStart)}-${fmtDot(monthEnd)}`,
    monthLabel: `${MONTHS_PL[monthStart.getMonth()]} ${monthStart.getFullYear()}`,
    monthCode: `${MONTH_CODES[monthStart.getMonth()]}_${monthStart.getFullYear()}`,
    channels,
    totalCost,
    totalReach,
    bestCpm: bestCpm ? { provider: bestCpm.provider, cpm: bestCpm.cpm! } : null,
    topFrequency: topFrequency
      ? { provider: topFrequency.provider, frequency: topFrequency.frequency! }
      : null,
    lookback,
    topCampaignNames,
    namingSegments,
    creativesReach,
    creativesTraffic,
    ai,
  };
}
