// Fills the official OLX Social Media Report template v3 (bundled, tokenized
// PPTX) with a month's segment data - fully server-side, no Google APIs.
// The template's {{tokens}} live in ppt/slides/slideN.xml text runs; we unzip
// with jszip, string-replace, re-zip. Creative thumbnails stay manual (image
// swaps can't be done via text replacement) - every text field is automated.
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

import {
  numFmt,
  plnFmt,
  type ChannelMonth,
  type OlxSmReportData,
} from "@/lib/report/olx-sm-data";
import type { AdProvider } from "@/lib/types";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "lib/report/templates/olx-sm-v3.pptx"
);

const PROVIDER_SHORT: Record<AdProvider, string> = {
  meta_ads: "Meta",
  google_ads: "Google",
  tiktok_ads: "TikTok",
};

const fmtM = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} M`
    : n >= 1_000
      ? `${(n / 1_000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} K`
      : numFmt(n);

function seg(d: OlxSmReportData, label: string, fallback = "N/A"): string {
  return d.namingSegments.find((s) => s.segment === label)?.value ?? fallback;
}

function channelRow(c: ChannelMonth | undefined): Record<string, string> {
  if (!c || c.cost <= 0) {
    return {
      reach: "N/A", impressions: "N/A", freq: "N/A", clicks: "N/A",
      cpc: "N/A", cpm: "N/A", spend: "N/A",
    };
  }
  return {
    reach: fmtM(c.reach),
    impressions: fmtM(c.impressions),
    freq: c.frequency != null ? c.frequency.toFixed(2) : "—",
    clicks: fmtM(c.clicks),
    cpc: c.cpc != null ? plnFmt(Math.round(c.cpc)) : "—",
    cpm: c.cpm != null ? plnFmt(Math.round(c.cpm)) : "—",
    spend: plnFmt(c.cost),
  };
}

/** Build every {{token}} the v3 template expects from a month's data. */
export function buildV3Tokens(d: OlxSmReportData): Record<string, string> {
  const meta = d.channels.find((c) => c.provider === "meta_ads");
  const tiktok = d.channels.find((c) => c.provider === "tiktok_ads");
  const topName = d.topCampaignNames[0]?.name ?? d.clientName;

  const pilar = seg(d, "PILAR");
  const typ = seg(d, "TYP");
  const cel = seg(d, "CEL");
  // periodLabel is "01.07.2026-31.07.2026" - numeric month/year for REPORT_ID.
  const numMonth = d.periodLabel.slice(3, 5);
  const numYear = d.periodLabel.slice(6, 10);

  const activeChannels = d.channels
    .filter((c) => c.cost > 0)
    .map((c) => PROVIDER_SHORT[c.provider]);

  const namingByProvider = (p: AdProvider): string =>
    d.topCampaignNames.find((c) => c.provider === p)?.name ?? "N/A";

  const lookRow = (p: AdProvider) =>
    d.lookback.find((l) => l.provider === p)?.months ?? [];
  const lookCell = (p: AdProvider, i: number): string => {
    const m = lookRow(p)[i];
    return m?.cpm != null ? plnFmt(Math.round(m.cpm)) : "—";
  };
  const lookTrend = (p: AdProvider): string => {
    const ms = lookRow(p);
    const prev = ms[1]?.cpm;
    const cur = ms[2]?.cpm;
    if (prev == null || cur == null) return "→ pierwsze dane w nowym formacie";
    const diff = ((cur - prev) / prev) * 100;
    const arrow = diff < -2 ? "↓" : diff > 2 ? "↑" : "→";
    return `${arrow} CPM ${diff >= 0 ? "+" : ""}${diff.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}% MoM`;
  };

  const metaRow = channelRow(meta);
  const tiktokRow = channelRow(tiktok);
  const naRow = channelRow(undefined);

  const bullets = (arr: string[], n: number): string[] =>
    Array.from({ length: n }, (_, i) => arr[i] ?? "—");
  const [mdd1, mdd2, mdd3, mdd4, mdd5] = bullets(d.ai.metaBullets, 5);
  const [tdd1, tdd2, tdd3, tdd4, tdd5] = bullets(d.ai.tiktokBullets, 5);
  const [ydd1, ydd2, ydd3, ydd4, ydd5] = bullets(d.ai.categoriesBullets, 5);

  const creative = (i: number) => d.creativesReach[i] ?? d.creativesTraffic[i];
  const crId = (i: number): string => creative(i)?.name ?? "—";
  const crKpi = (i: number): string => {
    const c = creative(i);
    return c ? `${c.metricLabel}: ${c.metricValue}` : "—";
  };

  const reportId = `OLX_SM_${pilar}_${typ}_${numMonth}_${numYear}`;
  const prevMonthNum = Number(numMonth) === 1 ? 12 : Number(numMonth) - 1;
  const prevYear = Number(numMonth) === 1 ? Number(numYear) - 1 : Number(numYear);
  const prevReportId = `OLX_SM_${pilar}_${typ}_${String(prevMonthNum).padStart(2, "0")}_${prevYear}`;

  return {
    // Cover / metadata
    campaign_name_full: topName,
    pilar,
    typ,
    cel,
    typ_yt: "N-A",
    opis: seg(d, "Opis", "—"),
    version: seg(d, "Wersja", "v1"),
    agency_code: seg(d, "Agencja", "PATO"),
    tg: "—",
    period: d.periodLabel,
    budget_total: plnFmt(d.totalCost),
    channels_line: activeChannels.join(" · ") || "—",
    asset_status: "Mix — uzupełnij New/Recycled",
    naming_meta: namingByProvider("meta_ads"),
    naming_tiktok: namingByProvider("tiktok_ads"),
    naming_linkedin: "N/A",
    naming_linkedin_group: "N/A",
    naming_youtube: "N/A",
    // Budget per channel
    meta_spend: metaRow.spend,
    tiktok_spend: tiktokRow.spend,
    youtube_spend: "N/A",
    linkedin_spend: "N/A",
    // Media results table
    meta_reach: metaRow.reach,
    meta_impressions: metaRow.impressions,
    meta_freq: metaRow.freq,
    meta_clicks: metaRow.clicks,
    meta_cpc: metaRow.cpc,
    meta_cpm: metaRow.cpm,
    tiktok_reach: tiktokRow.reach,
    tiktok_impressions: tiktokRow.impressions,
    tiktok_freq: tiktokRow.freq,
    tiktok_clicks: tiktokRow.clicks,
    tiktok_cpc: tiktokRow.cpc,
    tiktok_cpm: tiktokRow.cpm,
    ytli_reach: naRow.reach,
    ytli_impressions: naRow.impressions,
    ytli_freq: naRow.freq,
    ytli_clicks: naRow.clicks,
    ytli_cpc: naRow.cpc,
    ytli_cpm: naRow.cpm,
    ytli_spend: naRow.spend,
    // Headline KPIs
    total_reach: fmtM(d.totalReach),
    reach_delta: "—",
    best_cpm: d.bestCpm ? plnFmt(Math.round(d.bestCpm.cpm)) : "—",
    best_cpm_channel: d.bestCpm ? PROVIDER_SHORT[d.bestCpm.provider] : "—",
    top_freq: d.topFrequency ? d.topFrequency.frequency.toFixed(2) : "—",
    top_freq_channel: d.topFrequency
      ? PROVIDER_SHORT[d.topFrequency.provider]
      : "—",
    spend: plnFmt(d.totalCost),
    vs_planned: "—",
    // Lookback
    meta_m2: lookCell("meta_ads", 0),
    meta_m1: lookCell("meta_ads", 1),
    meta_m0: lookCell("meta_ads", 2),
    meta_trend: lookTrend("meta_ads"),
    tiktok_m2: lookCell("tiktok_ads", 0),
    tiktok_m1: lookCell("tiktok_ads", 1),
    tiktok_m0: lookCell("tiktok_ads", 2),
    tiktok_trend: tiktok ? lookTrend("tiktok_ads") : "N/A",
    // Creatives (text fields; thumbnails manual)
    meta_cr1_id: crId(0), meta_cr1_kpi: crKpi(0), meta_cr1_note: "—",
    meta_cr2_id: crId(1), meta_cr2_kpi: crKpi(1), meta_cr2_note: "—",
    meta_cr3_id: crId(2), meta_cr3_kpi: crKpi(2), meta_cr3_note: "—",
    tiktok_cr1_id: "N/A", tiktok_cr1_kpi: "—", tiktok_cr1_note: "—",
    tiktok_cr2_id: "N/A", tiktok_cr2_kpi: "—", tiktok_cr2_note: "—",
    tiktok_cr3_id: "N/A", tiktok_cr3_kpi: "—", tiktok_cr3_note: "—",
    ytli_cr1_id: "N/A", ytli_cr1_kpi: "—", ytli_cr1_note: "—",
    ytli_cr2_id: "N/A", ytli_cr2_kpi: "—", ytli_cr2_note: "—",
    ytli_cr3_id: "N/A", ytli_cr3_kpi: "—", ytli_cr3_note: "—",
    assets_total: String(d.creativesReach.length),
    assets_new_recycled: "—",
    ab_testing: "NO",
    ambassadors: "N/A",
    // Deep dive
    meta_flag: d.ai.metaFlag,
    meta_flag_desc: d.ai.flagAnomaly || "Brak anomalii",
    meta_dd1: mdd1, meta_dd2: mdd2, meta_dd3: mdd3, meta_dd4: mdd4, meta_dd5: mdd5,
    tiktok_flag: tiktok ? d.ai.tiktokFlag : "N/A",
    tiktok_flag_desc: tiktok ? "—" : "Kanał nieaktywny w tym raporcie",
    tiktok_dd1: tdd1, tiktok_dd2: tdd2, tiktok_dd3: tdd3, tiktok_dd4: tdd4, tiktok_dd5: tdd5,
    ytli_flag: "N/A",
    ytli_flag_desc: "Kanał nieaktywny w tym raporcie",
    ytli_dd1: ydd1, ytli_dd2: ydd2, ytli_dd3: ydd3, ytli_dd4: ydd4, ytli_dd5: ydd5,
    questions: d.ai.questions || "None",
    // Learnings & recommendations
    learning1: d.ai.learnings[0] ?? "—",
    learning2: d.ai.learnings[1] ?? "—",
    learning3: d.ai.learnings[2] ?? "—",
    reco1: d.ai.recommendations[0]?.text ?? "—",
    reco2: d.ai.recommendations[1]?.text ?? "—",
    reco3: d.ai.recommendations[2]?.text ?? "—",
    // AI summary block
    report_id: reportId,
    prev_report_id: prevReportId,
    budget_spent_line: `${plnFmt(d.totalCost)} total (Meta: ${metaRow.spend} TikTok: ${tiktokRow.spend} YT/LI: N/A)`,
    channels_dotted: activeChannels.join(".") || "—",
    top_cpm_line: d.bestCpm
      ? `${PROVIDER_SHORT[d.bestCpm.provider]}: ${plnFmt(Math.round(d.bestCpm.cpm))} (best)`
      : "N/A",
    top_reach_line: `Total: ${fmtM(d.totalReach)}`,
    best_creative_line: d.creativesReach[0]
      ? `${d.creativesReach[0].name} | Meta | ${d.creativesReach[0].metricLabel}: ${d.creativesReach[0].metricValue}`
      : "N/A",
    main_learning_1: d.ai.mainLearnings[0] ?? "—",
    main_learning_2: d.ai.mainLearnings[1] ?? "—",
    main_learning_3: d.ai.mainLearnings[2] ?? "N/A",
    flag_anomaly: d.ai.flagAnomaly || "None",
    trend_vs_prev: d.ai.trendVsPrev || "—",
  };
}

const escXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Copy the bundled template and replace every {{token}} across all slides. */
export async function fillV3Template(
  tokens: Record<string, string>
): Promise<Buffer> {
  const raw = await fs.readFile(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(raw);

  const slideNames = Object.keys(zip.files).filter((n) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n)
  );
  for (const name of slideNames) {
    let xml = await zip.file(name)!.async("string");
    xml = xml.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (whole, key: string) =>
      key in tokens ? escXml(tokens[key]) : whole
    );
    zip.file(name, xml);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Promise<Buffer>;
}
