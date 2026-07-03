import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import {
  buildDashboardContext,
  CHAT_SYSTEM_PROMPT,
  type DailyBreakdownRow,
} from "@/lib/ai/chat";
import { getDashboardData } from "@/lib/dashboard/metrics";
import { createClient } from "@/lib/supabase/server";

// Per-day, per-provider spend/clicks (+ GA4 sessions) for the last 30 days,
// so the assistant can answer arbitrary date-window questions.
async function getDailyBreakdown(
  supabase: SupabaseClient,
  clientId: string
): Promise<DailyBreakdownRow[]> {
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const start = formatInTimeZone(
    subDays(new Date(`${today}T00:00:00`), 29),
    "Europe/Warsaw",
    "yyyy-MM-dd"
  );

  const [adsRes, ga4Res] = await Promise.all([
    supabase
      .from("ads_daily")
      .select("date, provider, spend_minor_units, clicks")
      .eq("client_id", clientId)
      .gte("date", start)
      .lte("date", today),
    supabase
      .from("ga4_daily")
      .select("date, sessions")
      .eq("client_id", clientId)
      .is("source_medium", null)
      .is("device_category", null)
      .is("page_path", null)
      .gte("date", start)
      .lte("date", today),
  ]);

  const byDate = new Map<string, DailyBreakdownRow>();
  const get = (date: string) =>
    byDate.get(date) ??
    byDate
      .set(date, {
        date,
        metaSpendMinorUnits: 0,
        googleSpendMinorUnits: 0,
        clicks: 0,
        sessions: 0,
      })
      .get(date)!;

  for (const r of adsRes.data ?? []) {
    const row = get(r.date as string);
    const spend = Number(r.spend_minor_units);
    if (r.provider === "meta_ads") row.metaSpendMinorUnits += spend;
    else row.googleSpendMinorUnits += spend;
    row.clicks += Number(r.clicks);
  }
  for (const r of ga4Res.data ?? []) {
    get(r.date as string).sessions += Number(r.sessions);
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(30),
});

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ error: "Missing client" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS ensures a client user only resolves their own client; agency sees all.
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", clientSlug)
    .single();
  if (!client) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[ai/chat] ANTHROPIC_API_KEY is not set");
    return NextResponse.json(
      { error: "AI nie jest skonfigurowane (brak ANTHROPIC_API_KEY)" },
      { status: 500 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data = await getDashboardData(client.id, "30d");
  const daily = await getDailyBreakdown(supabase, client.id);
  const context = buildDashboardContext(client.name as string, data, daily);

  const anthropic = new Anthropic();
  // Thinking disabled for snappy chat replies; instruct final-answer-only so
  // Opus 4.8 doesn't leak reasoning into the visible response.
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    system: `${CHAT_SYSTEM_PROMPT}\n\nOdpowiadaj wyłącznie finalną odpowiedzią po polsku — bez rozpisywania toku rozumowania.\n\n--- DANE KAMPANII ---\n${context}`,
    messages: parsed.data.messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        stream.on("text", (text) => controller.enqueue(encoder.encode(text)));
        await stream.finalMessage();
      } catch (err) {
        console.error("[ai/chat] stream failed", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
