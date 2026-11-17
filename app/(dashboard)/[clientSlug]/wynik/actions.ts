"use server";

import { revalidatePath } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import { addDaysIso, isIsoDay, MANUAL_CHANNELS } from "@/lib/daily-net/calc";
import { MANUAL_COSTS_MIGRATION } from "@/lib/daily-net/load";
import { MAX_AMOUNT_ZL } from "@/lib/daily-net/paste";
import { requireClientEditor } from "@/lib/integrations/guard";
import { isMissingTableError } from "@/lib/shop/parse";
import { createAdminClient } from "@/lib/supabase/admin";

export type SaveManualCostsResult =
  | { ok: true; saved: number; deleted: number }
  | { ok: false; error: string };

/** A season of six channels is ~500 cells; a year of them stays well inside. */
const MAX_CHANGES = 3000;
const UPSERT_CHUNK = 500;
const DELETE_CHUNK = 100;

const Change = z.object({
  date: z.string().refine(isIsoDay),
  channel: z.enum(MANUAL_CHANNELS),
  // Grosze; null (or 0) clears the cell - zero is never stored.
  minor: z
    .number()
    .int()
    .min(0)
    .max(MAX_AMOUNT_ZL * 100)
    .nullable(),
});

const Payload = z.object({
  client: z.string().min(1).max(64),
  changes: z.array(Change).min(1).max(MAX_CHANGES),
});

/**
 * Bulk save of the "Koszty spoza integracji" grid: every changed cell in
 * one call - amounts upserted, cleared or zero cells deleted. Agency users
 * and the client's own users may write (they keep this sheet today); the
 * guard checks that, then the write goes through the service role pinned
 * to the guarded client id. Callable as a raw POST, so the payload is
 * validated here whatever the browser sent.
 */
export async function saveManualCosts(raw: unknown): Promise<SaveManualCostsResult> {
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Nieprawidłowe dane - odśwież stronę i spróbuj jeszcze raz." };
  const { client, changes } = parsed.data;

  const access = await requireClientEditor(client);
  if (!access.ok) return { ok: false, error: "Brak uprawnień do zapisu kosztów tego klienta." };
  if (access.clientType !== "ecommerce") return { ok: false, error: "Ta strona jest tylko dla sklepów." };

  // History the shop's sheet may still hold (a few seasons back), never the future.
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const minDate = addDaysIso(today, -5 * 366);
  const maxDate = addDaysIso(today, 1);
  if (changes.some((c) => c.date < minDate || c.date > maxDate)) {
    return { ok: false, error: "Daty spoza zakresu - koszty wpisuje się do dnia jutrzejszego, najdalej 5 lat wstecz." };
  }

  // The last change of a cell wins (a payload could repeat one).
  const byCell = new Map<string, (typeof changes)[number]>();
  for (const c of changes) byCell.set(`${c.date}|${c.channel}`, c);
  const upserts = [...byCell.values()].filter((c) => c.minor !== null && c.minor > 0);
  const deletes = [...byCell.values()].filter((c) => c.minor === null || c.minor === 0);

  const admin = createAdminClient();
  const updatedAt = new Date().toISOString();
  const fail = (error: { code?: string | null; message: string }): SaveManualCostsResult => {
    if (isMissingTableError(error)) {
      return { ok: false, error: `Najpierw uruchom migrację ${MANUAL_COSTS_MIGRATION} w Supabase.` };
    }
    console.error("[wynik] manual costs save failed", error);
    return { ok: false, error: "Nie udało się zapisać - spróbuj jeszcze raz." };
  };

  // Chunks run one after another; a failed one leaves the earlier ones
  // written, which is harmless: saving the same grid again converges.
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const rows = upserts.slice(i, i + UPSERT_CHUNK).map((c) => ({
      client_id: access.clientId,
      date: c.date,
      channel: c.channel,
      amount_minor_units: c.minor,
      updated_at: updatedAt,
      updated_by: access.user.id,
    }));
    const { error } = await admin.from("manual_ad_costs").upsert(rows, { onConflict: "client_id,date,channel" });
    if (error) return fail(error);
  }

  const datesByChannel = new Map<string, string[]>();
  for (const c of deletes) datesByChannel.set(c.channel, [...(datesByChannel.get(c.channel) ?? []), c.date]);
  for (const [channel, dates] of datesByChannel) {
    for (let i = 0; i < dates.length; i += DELETE_CHUNK) {
      const { error } = await admin
        .from("manual_ad_costs")
        .delete()
        .eq("client_id", access.clientId)
        .eq("channel", channel)
        .in("date", dates.slice(i, i + DELETE_CHUNK));
      if (error) return fail(error);
    }
  }

  revalidatePath(`/${access.clientSlug}/wynik`);
  return { ok: true, saved: upserts.length, deleted: deletes.length };
}
