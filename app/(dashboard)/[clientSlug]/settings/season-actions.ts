"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import type { SeasonConfig } from "@/lib/season/config";
import { createAdminClient } from "@/lib/supabase/admin";

// February stops at 28: a season edge on 29 Feb would not exist three years
// out of four, and lib/season builds every window from these month-days.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad = (n: number) => String(n).padStart(2, "0");

const MonthDay = z
  .object({
    day: z.coerce.number().int().min(1).max(31),
    month: z.coerce.number().int().min(1).max(12),
  })
  .refine(({ day, month }) => day <= DAYS_IN_MONTH[month - 1])
  .transform(({ day, month }) => `${pad(month)}-${pad(day)}`);

// An identical start and end would be a one-day (or a whole-year) season;
// parseSeason rejects it too, so it must not be stored.
const SAME_DAY = "season_same_day";

const Season = z
  .object({ start: MonthDay, end: MonthDay })
  .refine((s) => s.start !== s.end, { message: SAME_DAY });

const Base = z.object({
  clientType: z.enum(["engagement", "ecommerce"]),
  seasonal: z.boolean(),
});

/** Postgres 42703 / PostgREST schema cache PGRST204: column not migrated. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/**
 * Save the client type and the season window (agency only). Unticking
 * "Klient sezonowy" clears the season. Season dates are only read when it is
 * ticked, because the date selects are disabled before migration 0037.
 */
export async function saveSeasonSettings(formData: FormData) {
  const slug = z.string().min(1).max(100).safeParse(formData.get("client"));
  if (!slug.success) return;
  const clientSlug = slug.data;

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;

  const back = (param: string) => `/${clientSlug}/settings?${param}#sezon`;

  const base = Base.safeParse({
    clientType: formData.get("client_type"),
    seasonal: formData.get("seasonal") === "on",
  });
  if (!base.success) redirect(back("error=season_failed"));
  const { clientType, seasonal } = base.data;

  let season: SeasonConfig | null = null;
  if (seasonal) {
    const parsed = Season.safeParse({
      start: { day: formData.get("start_day"), month: formData.get("start_month") },
      end: { day: formData.get("end_day"), month: formData.get("end_month") },
    });
    if (!parsed.success) {
      const sameDay = parsed.error.issues.some((i) => i.message === SAME_DAY);
      redirect(back(sameDay ? "error=season_same_day" : "error=season_bad_date"));
    }
    season = parsed.data;
  }

  // clients only has a SELECT policy (0002), so writes go through the
  // service role - and only after the agency guard above.
  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({ client_type: clientType, season })
    .eq("id", access.clientId);

  if (error) {
    if (!isMissingColumn(error)) {
      console.error("[settings] season save failed", error);
      redirect(back(error.code === "23514" ? "error=season_bad_date" : "error=season_failed"));
    }
    // Most likely clients.season (0037) isn't there yet: the client type
    // (0016) can still be saved on its own.
    const typeOnly = await admin
      .from("clients")
      .update({ client_type: clientType })
      .eq("id", access.clientId);
    if (typeOnly.error) {
      if (!isMissingColumn(typeOnly.error)) {
        console.error("[settings] client type save failed", typeOnly.error);
      }
      redirect(
        back(isMissingColumn(typeOnly.error) ? "error=season_type_migration" : "error=season_failed")
      );
    }
    revalidatePath(`/${clientSlug}`, "layout");
    // Nothing was asked of the missing column when the box was unticked.
    redirect(back(season ? "error=season_migration" : "saved=season"));
  }

  // Type and season both shape the nav (Sprzedaż, Sezon) in the shared layout.
  revalidatePath(`/${clientSlug}`, "layout");
  redirect(back("saved=season"));
}

// "12 000", "12000,50", "1 200 000 zł" -> grosze; empty clears the budget.
const BudgetZl = z
  .string()
  .max(40)
  .transform((s) => s.replace(/zł/gi, "").replace(/[\s ]/g, "").replace(",", "."))
  .refine((s) => s === "" || /^\d+(\.\d{1,2})?$/.test(s))
  .transform((s) => (s === "" ? null : Math.round(Number(s) * 100)))
  .refine((v) => v === null || (v > 0 && v <= 100_000_000_000));

/**
 * Save the season's ad budget (agency only). Drives "Budżet sezonu": the
 * plan is spread over the days along last season's spending.
 */
export async function saveSeasonBudget(formData: FormData) {
  const slug = z.string().min(1).max(100).safeParse(formData.get("client"));
  if (!slug.success) return;
  const clientSlug = slug.data;
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return;
  const back = (param: string) => `/${clientSlug}/settings?${param}#sezon`;

  const parsed = BudgetZl.safeParse(String(formData.get("budget") ?? ""));
  if (!parsed.success) redirect(back("error=season_budget_bad"));

  const { error } = await createAdminClient()
    .from("clients")
    .update({ season_budget: parsed.data === null ? null : { total: parsed.data } })
    .eq("id", access.clientId);
  if (error) {
    if (!isMissingColumn(error)) console.error("[settings] season budget save failed", error);
    redirect(back(isMissingColumn(error) ? "error=season_budget_migration" : "error=season_failed"));
  }
  revalidatePath(`/${clientSlug}`, "layout");
  redirect(back("saved=season_budget"));
}
