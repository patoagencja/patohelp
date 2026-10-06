import Anthropic from "@anthropic-ai/sdk";
import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAll } from "@/lib/supabase/fetch-all";

const WARSAW_TZ = "Europe/Warsaw";

// Client-facing copy is read by marketing managers and their boards, not by
// ad specialists - jargon makes the summary useless to the person paying.
const PLAIN_LANGUAGE = `Pisz dla osoby bez wiedzy marketingowej (np. menedżer, zarząd):
- zamiast "CTR" pisz "klikalność" (ile osób na 100, które zobaczyły reklamę, kliknęło),
- zamiast "CPC" pisz "koszt jednego kliknięcia",
- zamiast "sesje", "GA4" pisz "wizyty na stronie",
- zamiast "ROAS" pisz "ile złotych sprzedaży przyniosła każda złotówka wydana na reklamy",
- żadnych innych skrótów i angielskich terminów (spend, performance, PMax itp.).
Kwoty zaokrąglaj do pełnych złotych. Nie obiecuj działań w imieniu agencji ("zrobimy", "zmienimy") - sugestię formułuj jako rzecz do omówienia.`;

function systemPrompt(clientName: string, isShop: boolean): string {
  const kind = isShop
    ? `Klient to sklep internetowy ${clientName} - liczy się sprzedaż (przychód, liczba zamówień) i to, ile sprzedaży przynoszą reklamy.`
    : `Klient to firma ${clientName} - nie sprzedaje online, mierzymy ruch i zainteresowanie (kliknięcia, wizyty na stronie, koszt kliknięcia). Nigdy nie pisz o sprzedaży, przychodzie ani zwrocie z reklam.`;
  return `Jesteś opiekunem klienta w agencji marketingowej i piszesz cotygodniowe podsumowanie dla klienta.
${kind}
Pisz 3-4 zdania po polsku, konkretnie, bez ogólników agencyjnych typu "kontynuujemy optymalizację".
Zawsze zawieraj:
- konkretną liczbę z danych,
- porównanie do poprzedniego tygodnia,
- jedną obserwację, co warte uwagi,
- jedną sugestię, co warto omówić.
${PLAIN_LANGUAGE}
Ton: życzliwy, profesjonalny, nie sztywny. Bez emoji. Bez markdown.`;
}

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
  // The last 7 COMPLETE Warsaw days vs the 7 before. The cron runs at
  // ~6-7am Warsaw, so a window ending "today" held 6 full days plus an almost
  // empty one against 7 full days: every summary opened with a ~14% "drop"
  // in clicks/spend/visits that the panel didn't show. Date-string maths so
  // DST days can't shift a boundary.
  const today = formatInTimeZone(new Date(), WARSAW_TZ, "yyyy-MM-dd");
  const shift = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const end = shift(today, -1);
  const start = shift(end, -6);
  const prevEnd = shift(end, -7);
  const prevStart = shift(end, -13);

  const { data: clientRow } = await admin
    .from("clients")
    .select("name, client_type")
    .eq("id", clientId)
    .maybeSingle();
  const clientName = (clientRow?.name as string | undefined) ?? "klient";
  const isShop =
    (clientRow as { client_type?: string } | null)?.client_type === "ecommerce";

  const [adsRows, ga4Res, eventsRes] = await Promise.all([
    // Paginated: 14 days x every campaign of 3 Google accounts + Meta passes
    // PostgREST's silent 1000-row cap, and the summary then quoted truncated
    // totals that contradicted the KPI cards.
    fetchAll<Record<string, unknown>>((from, to) =>
      admin
        .from("ads_daily")
        .select(
          "provider, campaign_id, campaign_name, date, spend_minor_units, clicks, impressions"
        )
        .eq("client_id", clientId)
        .gte("date", prevStart)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("provider", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to)
    ),
    admin
      .from("ga4_daily")
      .select(isShop ? "date, sessions, revenue_minor_units, transactions" : "date, sessions")
      .eq("client_id", clientId)
      .is("source_medium", null)
      .is("device_category", null)
      .is("page_path", null)
      .gte("date", prevStart)
      .lte("date", end),
    // The service-role client bypasses RLS, so agency-only notes must be
    // filtered here or they'd end up in text the client reads. Before
    // migration 0029 the column doesn't exist and every event is visible.
    (async () => {
      const base = () =>
        admin
          .from("client_events")
          .select("event_date, title")
          .eq("client_id", clientId)
          // Only what happened in the two compared weeks: older (or future)
          // entries read as explanations for this week's numbers.
          .gte("event_date", prevStart)
          .lte("event_date", end)
          .order("event_date", { ascending: false })
          .limit(3);
      const visible = await base().eq("visible_to_client", true);
      return visible.error ? base() : visible;
    })(),
  ]);

  const rows = adsRows;
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
        provider:
          r.provider === "meta_ads"
            ? "Meta"
            : r.provider === "tiktok_ads"
              ? "TikTok"
              : "Google",
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
  let curRevenue = 0;
  let prevRevenue = 0;
  let curOrders = 0;
  let prevOrders = 0;
  for (const r of (ga4Res.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const d = r.date as string;
    const rev = Number(r.revenue_minor_units ?? 0);
    const ord = Number(r.transactions ?? 0);
    if (inCur(d)) {
      curSessions += Number(r.sessions);
      curRevenue += rev;
      curOrders += ord;
    } else if (inPrev(d)) {
      prevSessions += Number(r.sessions);
      prevRevenue += rev;
      prevOrders += ord;
    }
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
    `OSTATNIE 7 DNI (${start} - ${end}):`,
    `- Wydatki: ${pln(curSpend)} (poprzednie 7 dni: ${pln(prevSpend)}, zmiana: ${delta(curSpend, prevSpend)})`,
    `- Kliknięcia: ${curClicks} (poprzednio: ${prevClicks}, zmiana: ${delta(curClicks, prevClicks)})`,
    `- CTR: ${pct(curCtr)} (poprzednio: ${pct(prevCtr)})`,
    `- CPC: ${pln(Math.round(curCpc))} (poprzednio: ${pln(Math.round(prevCpc))})`,
    curSessions > 0 || prevSessions > 0
      ? `- Sesje GA4: ${curSessions} (poprzednio: ${prevSessions}, zmiana: ${delta(curSessions, prevSessions)})`
      : `- Sesje GA4: brak danych`,
    ...(isShop && (curRevenue > 0 || prevRevenue > 0)
      ? [
          `- Sprzedaż (GA4): ${pln(curRevenue)} (poprzednio: ${pln(prevRevenue)}, zmiana: ${delta(curRevenue, prevRevenue)})`,
          `- Zamówienia: ${curOrders} (poprzednio: ${prevOrders}, zmiana: ${delta(curOrders, prevOrders)})`,
          `- Sprzedaż na 1 zł reklam: ${curSpend > 0 ? (curRevenue / curSpend).toFixed(2) : "-"} zł (poprzednio: ${prevSpend > 0 ? (prevRevenue / prevSpend).toFixed(2) : "-"} zł)`,
        ]
      : []),
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
    system: systemPrompt(clientName, isShop),
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
