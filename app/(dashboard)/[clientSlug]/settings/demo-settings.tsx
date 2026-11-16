import { formatInTimeZone } from "date-fns-tz";

import { Card, CardContent } from "@/components/ui/card";
import { DEMO_BRAND } from "@/lib/demo/brand";
import { profileKpis } from "@/lib/demo/profile/anonymize";
import { getDemoProfileStatus } from "@/lib/demo/profile/store";
import { diffDaysIso, PROFILE_MAX_AGE_DAYS } from "@/lib/demo/source";
import { dayLabelPl } from "@/lib/ecom/insights";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoneyPLN, formatMultiple } from "@/lib/utils";

import { DemoButtons } from "./demo-buttons";
import { SettingsHeading } from "./settings-heading";

/**
 * "Demo": puts this shop's recent numbers - anonymized, as the fictional
 * shop of the public demo - on /demo-full, or takes them off. Rendered only
 * for agency admins on e-commerce clients; the actions re-check both.
 */
export async function DemoSettingsSection({ clientId, clientSlug }: { clientId: string; clientSlug: string }) {
  const status = await getDemoProfileStatus(createAdminClient(), clientId);
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const p = status.profile;
  const stale = p ? diffDaysIso(p.snapshotDate, today) > PROFILE_MAX_AGE_DAYS : false;
  const kpis = p && status.source === "this" ? profileKpis(p) : null;
  const pct = (v: number) => `${(v * 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 })}%`;

  return (
    <div id="demo" className="scroll-mt-32 space-y-4">
      <SettingsHeading
        kicker="Ustawienia · Demo"
        title="Demo"
        description={`Publiczne demo (/demo-full) może pokazać prawdziwe liczby tego sklepu jako fikcyjny sklep ${DEMO_BRAND}. Trafiają tam tylko liczby z ostatnich 9 tygodni (i z tych samych tygodni rok wcześniej), przeliczone przez losowe współczynniki - bez nazw kampanii, produktów, stron, fraz i kont. Widzi to tylko administrator agencji.`}
      />
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-4 pt-6 text-sm">
          <p>
            {status.source === "this" && p
              ? `Demo pokazuje teraz liczby tego klienta - zrzut z ${dayLabelPl(p.snapshotDate)} (ostatni pełny dzień).`
              : status.source === "other" && p
                ? `Demo pokazuje teraz liczby innego klienta (zrzut z ${dayLabelPl(p.snapshotDate)}). Przycisk poniżej zastąpi je liczbami tego klienta.`
                : "Demo pokazuje teraz przykładowe dane."}
            {stale ? " Zrzut ma ponad 5 tygodni, więc demo wróciło do przykładowych danych - zrób nowy." : ""}
          </p>
          {kpis && kpis.aov !== null && kpis.cpc !== null && kpis.cr !== null && kpis.roas !== null ? (
            <p className="text-muted-foreground">
              W demo z ostatnich 30 dni: średnie zamówienie {formatMoneyPLN(kpis.aov)}, koszt kliknięcia{" "}
              {formatMoneyPLN(kpis.cpc)}, konwersja {pct(kpis.cr)}, ROAS {formatMultiple(kpis.roas)}.
            </p>
          ) : null}
          <DemoButtons clientSlug={clientSlug} hasProfile={status.source !== "none"} usedElsewhere={status.source === "other"} />
        </CardContent>
      </Card>
    </div>
  );
}
