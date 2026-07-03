import Anthropic from "@anthropic-ai/sdk";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

const WARSAW_TZ = "Europe/Warsaw";

const SYSTEM_PROMPT = `Jesteś ekspertem od performance marketingu piszącym cotygodniowe podsumowanie dla klienta agencji.
Klient to firma DRE (producent drzwi, non-ecom — mierzymy ruch i engagement, nie sprzedaż).
Pisz 3-4 zdania po polsku, konkretnie, bez ogólników agencyjnych typu "kontynuujemy optymalizację".
Zawsze zawieraj:
- KONKRETNĄ liczbę / metrykę (spend, CTR, CPC)
- Porównanie do poprzedniego okresu
- Jedną obserwację o tym co warte uwagi
- Jedną sugestię co warto omówić / zmienić
Ton: profesjonalny ale nie sztywny. Bez emoji. Bez markdown formatting.`;

const pln = (minor: number) => `${(minor / 100).toFixed(2)} PLN`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const delta = (cur: number, prev: number) =>
  prev > 0 ? `${(((cur - prev) / prev) * 100).toFixed(1)}%` : "brak danych";

/**
 * Build the weekly data context, ask Claude for a 3-4 sentence Polish summary
 * and persist it to ai_summaries. Returns the summary text.
 * Requires a service-role Supabase client (runs from cron).
 */
export async function generateWeeklySummary(
  admin: SupabaseClient,
  clientId: string
): Promise<string> {
  const now = new Date();
  const end = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  const start = formatInTimeZone(subDays(now, 6), WARSAW_TZ, "yyyy-MM-dd");
  const prevEnd = formatInTimeZone(subDays(now, 7), WARSAW_TZ, "yyyy-MM-dd");
  const prevStart = formatInTimeZone(subDays(now, 13), WARSAW_TZ, "yyyy-MM-dd");

  const [adsRes, ga4Res, eventsRes] = await Promise.all([
    admin
      .from("ads_daily")
      .select(
        "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions"
      )
      .eq("client_id", clientId)
      .gte("date", prevStart)
      .lte("date", end),
    admin
      .from("ga4_daily")
      .select("date, sessions")
      .eq("client_id", clientId)
      .is("source_medium", null)
      .is("device_category", null)
      .is("page_path", null)
      .gte("date", prevStart)
      .lte("date", end),
    admin
      .from("client_events")
      .select("event_date, title")
      .eq("client_id", clientId)
      .order("event_date", { ascending: false })
      .limit(3),
  ]);

  const rows = adsRes.data ?? [];
  const inCur = (d: string) => d >= start && d <= end;
  const inPrev = (d: string) => d >= prevStart && d <= prevEnd;

  let curSpend = 0, curClicks = 0, curImpr = 0;
  let prevSpend = 0, prevClicks = 0, prevImpr = 0;

  interface Camp {
    name: string;
    provider: string;
    cur: number;
    prev: number;
    clicks: number;
    impressions: number;
  }
  const campaigns = new Map<string, Camp>();

  for (const r of rows) {
    const spend = Number(r.spend_minor_units);
    const clicks = Number(r.clicks);
    const impressions = Number(r.impressions);
    const key = `${r.provider}:${r.campaign_id}`;
    const c =
      campaigns.get(key) ??
      ({
        name: (r.campaign_name as string) || (r.campaign_id as string),
        provider: r.provider === "meta_ads" ? "Meta" : "Google",
        cur: 0,
        prev: 0,
        clicks: 0,
        impressions: 0,
      } as Camp);

    if (inCur(r.date as string)) {
      curSpend += spend;
      curClicks += clicks;
      curImpr += impressions;
      c.cur += spend;
      c.clicks += clicks;
      c.impressions += impressions;
    } else if (inPrev(r.date as string)) {
      prevSpend += spend;
      prevClicks += clicks;
      prevImpr += impressions;
      c.prev += spend;
    }
    campaigns.set(key, c);
  }

  let curSessions = 0;
  let prevSessions = 0;
  for (const r of ga4Res.data ?? []) {
    if (inCur(r.date as string)) curSessions += Number(r.sessions);
    else if (inPrev(r.date as string)) prevSessions += Number(r.sessions);
  }

  const list = Array.from(campaigns.values());
  const topSpend = list.sort((a, b) => b.cur - a.cur).slice(0, 3);
  const biggestChanges = list
    .filter((c) => c.prev > 0 || c.cur > 0)
    .sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev))
    .slice(0, 3);

  const curCtr = curImpr > 0 ? (curClicks / curImpr) * 100 : 0;
  const prevCtr = prevImpr > 0 ? (prevClicks / prevImpr) * 100 : 0;
  const curCpc = curClicks > 0 ? curSpend / curClicks : 0;
  const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;

  const context = [
    `OSTATNIE 7 DNI (${start} — ${end}):`,
    `- Wydatki: ${pln(curSpend)} (poprzednie 7 dni: ${pln(prevSpend)}, zmiana: ${delta(curSpend, prevSpend)})`,
    `- Kliknięcia: ${curClicks} (poprzednio: ${prevClicks}, zmiana: ${delta(curClicks, prevClicks)})`,
    `- CTR: ${pct(curCtr)} (poprzednio: ${pct(prevCtr)})`,
    `- CPC: ${pln(Math.round(curCpc))} (poprzednio: ${pln(Math.round(prevCpc))})`,
    curSessions > 0 || prevSessions > 0
      ? `- Sesje GA4: ${curSessions} (poprzednio: ${prevSessions}, zmiana: ${delta(curSessions, prevSessions)})`
      : `- Sesje GA4: brak danych`,
    "",
    "TOP 3 KAMPANIE (wydatki 7 dni):",
    ...topSpend.map(
      (c) =>
        `- ${c.name} [${c.provider}]: ${pln(c.cur)}, ${c.clicks} kliknięć, CTR ${pct(
          c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0
        )}`
    ),
    "",
    "NAJWIĘKSZE ZMIANY TYDZIEŃ DO TYGODNIA:",
    ...biggestChanges.map(
      (c) =>
        `- ${c.name} [${c.provider}]: ${pln(c.prev)} -> ${pln(c.cur)}`
    ),
    "",
    "OSTATNIE WYDARZENIA:",
    ...((eventsRes.data ?? []).length > 0
      ? (eventsRes.data ?? []).map((e) => `- ${e.event_date}: ${e.title}`)
      : ["- brak"]),
  ].join("\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Napisz podsumowanie tygodnia na podstawie danych:\n\n${context}`,
      },
    ],
  });

  const summary =
    response.content.find((b) => b.type === "text")?.text.trim() ?? "";
  if (!summary) throw new Error("Empty summary from model");

  await admin.from("ai_summaries").insert({
    client_id: clientId,
    summary_text: summary,
    period_start: start,
    period_end: end,
  });

  return summary;
}
