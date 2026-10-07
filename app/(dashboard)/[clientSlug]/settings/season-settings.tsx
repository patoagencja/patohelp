import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  MONTH_GEN,
  dayMonthLong,
  daysWord,
  parseSeason,
  seasonLength,
  seasonWindow,
  type SeasonConfig,
} from "@/lib/season/config";
import { createAdminClient } from "@/lib/supabase/admin";

import { CHECKBOX_CLASS, FIELD_CLASS, RADIO_CLASS } from "./form-styles";
import { saveSeasonSettings } from "./season-actions";
import { SettingsHeading } from "./settings-heading";

/** Christmas trade: the window the first seasonal client lives on. */
const DEFAULT_SEASON: SeasonConfig = { start: "10-01", end: "12-24" };

const TYPES = [
  {
    value: "engagement",
    label: "Zasięgowy (kliknięcia, ruch - bez przychodu)",
    hint: "Cele miesięczne, kliknięcia i ruch na stronie. Klient nie widzi przychodu ani zwrotu z reklam.",
  },
  {
    value: "ecommerce",
    label: "Sklep (sprzedaż, zwrot z reklam)",
    hint: "Zakładka Sprzedaż, marża i cele przychodu. Tylko dla klientów, którzy sprzedają online.",
  },
] as const;

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function DateFields({
  legend,
  name,
  value,
}: {
  legend: string;
  name: "start" | "end";
  /** "MM-DD" */
  value: string;
}) {
  const [month, day] = value.split("-").map(Number);
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      <div className="mt-1 flex gap-2">
        <select
          name={`${name}_day`}
          defaultValue={day}
          aria-label={`${legend}: dzień`}
          className={`${FIELD_CLASS} w-20 shrink-0 tabular-nums`}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          name={`${name}_month`}
          defaultValue={month}
          aria-label={`${legend}: miesiąc`}
          className={`${FIELD_CLASS} min-w-0 flex-1`}
        >
          {MONTH_GEN.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

/**
 * "Sezon i typ klienta" (agency only). The type decides what the client
 * sees (traffic vs sales, ROAS); the season switches on the Sezon view and
 * the longer ad history. Both columns arrive with migrations (0016, 0037),
 * so each is read on its own and a missing one only disables its fields.
 */
export async function SeasonSettingsSection({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const admin = createAdminClient();
  const [typeRes, seasonRes] = await Promise.all([
    admin.from("clients").select("client_type").eq("id", clientId).maybeSingle(),
    admin.from("clients").select("season").eq("id", clientId).maybeSingle(),
  ]);
  const typeAvailable = !typeRes.error;
  const seasonAvailable = !seasonRes.error;
  const clientType =
    (typeRes.data as { client_type?: string } | null)?.client_type === "ecommerce"
      ? "ecommerce"
      : "engagement";
  const season = parseSeason((seasonRes.data as { season?: unknown } | null)?.season);
  const shown = season ?? DEFAULT_SEASON;
  // Any non-leap year: only the length and the year rollover matter here.
  const w = season ? seasonWindow(season, 2025) : null;
  const saved = w
    ? {
        start: w.start,
        end: w.end,
        wraps: w.end.slice(0, 4) !== w.start.slice(0, 4),
        days: seasonLength(w),
      }
    : null;

  return (
    <div id="sezon" className="scroll-mt-32 space-y-4">
      <SettingsHeading
        kicker="Ustawienia · Klient"
        title="Sezon i typ klienta"
        description="Typ decyduje, co klient widzi w panelu: ruch i kliknięcia albo sprzedaż i zwrot z reklam. Klient sezonowy dostaje widok „Sezon” - porównanie z poprzednim sezonem dzień po dniu."
      />

      {!typeAvailable ? (
        <Card className="max-w-2xl">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Uruchom w Supabase migrację{" "}
            <code className="rounded bg-muted px-1">0016_ecommerce.sql</code>, żeby
            ustawić typ klienta.
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <form action={saveSeasonSettings} className="flex flex-col gap-6">
              <input type="hidden" name="client" value={clientSlug} />

              <fieldset>
                <legend className="text-sm font-medium">Typ klienta</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {TYPES.map((t) => (
                    <label
                      key={t.value}
                      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[20px] bg-chip p-3.5 text-sm transition-colors hover:bg-[var(--chip-hover)] has-[:checked]:bg-[var(--chip-hover)] has-[:checked]:ring-1 has-[:checked]:ring-anchor"
                    >
                      <input
                        type="radio"
                        name="client_type"
                        value={t.value}
                        defaultChecked={clientType === t.value}
                        className={`mt-0.5 ${RADIO_CLASS}`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{t.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {!seasonAvailable ? (
                <p className="-mb-3 text-xs text-warning">
                  Najpierw uruchom{" "}
                  <code className="rounded bg-muted px-1">ALL_RECENT_7.sql</code> w
                  Supabase SQL Editor - do tego czasu zapiszesz tylko typ klienta.
                </p>
              ) : null}

              {/* A disabled fieldset disables (and drops from the post) every
                  field inside, so a missing 0037 can't fail the type save. */}
              <fieldset
                disabled={!seasonAvailable}
                className="group/season flex flex-col gap-4 rounded-2xl bg-lime-soft/60 p-4 disabled:opacity-60"
              >
                <legend className="sr-only">Sezon</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    id="season-on"
                    type="checkbox"
                    name="seasonal"
                    defaultChecked={season !== null}
                    className={`mt-0.5 ${CHECKBOX_CLASS}`}
                  />
                  <span>
                    <span className="font-medium">Klient sezonowy</span>
                    <span className="block text-xs text-muted-foreground">
                      Zarabia w jednym oknie w roku, np. prezenty na święta. Włącza
                      widok „Sezon” w menu klienta.
                    </span>
                  </span>
                </label>

                {/* Dimmed while unticked: the dates only count for a seasonal
                    client. CSS only - they stay editable to set up first. */}
                <div className="grid gap-3 transition-opacity sm:grid-cols-2 group-has-[#season-on:not(:checked)]/season:opacity-50">
                  <DateFields legend="Początek sezonu" name="start" value={shown.start} />
                  <DateFields legend="Koniec sezonu" name="end" value={shown.end} />
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {saved ? (
                    <p className="font-medium text-foreground">
                      Zapisany sezon: od {dayMonthLong(saved.start)} do{" "}
                      {dayMonthLong(saved.end)}
                      {saved.wraps ? " następnego roku" : ""} · {saved.days}{" "}
                      {daysWord(saved.days)}
                    </p>
                  ) : null}
                  <p>
                    Koniec wcześniej niż początek oznacza sezon przechodzący na
                    kolejny rok, np. od 1 listopada do 6 stycznia (Befana we
                    Włoszech).
                  </p>
                  <p>
                    Klient sezonowy ma ok. 15 miesięcy historii reklam zamiast roku,
                    żeby porównać cały poprzedni sezon. Pierwsza synchronizacja po
                    włączeniu dociągnie starsze dane.
                  </p>
                </div>
              </fieldset>

              <Button type="submit" size="pill" className="w-fit">
                Zapisz typ i sezon
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
