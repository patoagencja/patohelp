import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getEcomSettings,
  getRevenueGoals,
  monthLabelPl,
  todayWarsaw,
} from "@/lib/ecom/insights";

import { saveEcomSettings } from "./ecom-actions";

/** Current month + the next two (October onward this covers Q4 planning). */
function upcomingMonths(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  return [0, 1, 2].map((i) => {
    const d = new Date(Date.UTC(y, m + i, 1));
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Margin + revenue goals for e-commerce clients. The margin turns ROAS into
 * profit; goals drive the month pacing card and the Q4 budget suggestion.
 */
export async function EcomSettingsSection({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const months = upcomingMonths(todayWarsaw());
  const [settings, goals] = await Promise.all([
    getEcomSettings(clientId),
    getRevenueGoals(clientId, months),
  ]);

  return (
    <div id="ecommerce" className="mt-8 scroll-mt-6">
      <h2 className="text-lg font-semibold">E-commerce: marża i cele sprzedaży</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Marża zamienia ROAS w realny zysk po reklamie. Cele pokazują klientowi
        postęp miesiąca i prognozę, a na Q4 - budżet potrzebny do ich dowiezienia.
      </p>

      {!settings.available ? (
        <Card className="mt-4 max-w-2xl">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Uruchom w Supabase migrację{" "}
            <code className="rounded bg-muted px-1">0021_ecom_settings.sql</code>, żeby
            włączyć marżę i cele.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4 max-w-2xl">
          <CardContent className="pt-6">
            <form action={saveEcomSettings} className="flex flex-col gap-5">
              <input type="hidden" name="client" value={clientSlug} />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Marża brutto (%)</span>
                  <input
                    name="gross_margin_pct"
                    inputMode="decimal"
                    placeholder="np. 55"
                    defaultValue={settings.marginPct ?? ""}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    Średnia marża na sprzedaży netto (po kosztach towaru).
                  </span>
                </label>
                <label className="flex items-start gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    name="revenue_includes_vat"
                    defaultChecked={settings.revenueIncludesVat}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    Przychód w GA4 zawiera VAT
                    <span className="block text-xs text-muted-foreground">
                      Zwykle tak w polskich sklepach - odejmiemy 23% przed liczeniem zysku.
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <p className="text-sm font-medium">Cele przychodu (zł)</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {months.map((m) => (
                    <label key={m} className="flex flex-col gap-1 text-xs">
                      <span className="capitalize text-muted-foreground">
                        {monthLabelPl(m)}
                      </span>
                      <input type="hidden" name="goal_month" value={m} />
                      <input
                        name={`goal_${m}`}
                        inputMode="decimal"
                        placeholder="brak celu"
                        defaultValue={
                          goals.has(m) ? Math.round(goals.get(m)! / 100) : ""
                        }
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <Button type="submit" size="sm" className="w-fit">
                Zapisz e-commerce
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
