import { formatInTimeZone } from "date-fns-tz";
import { TriangleAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { getIngestKeyStatus, type IngestKeyStatus } from "@/lib/shop/ingest";
import { MAX_API_ROWS, PRODUCT_MAX } from "@/lib/shop/parse";
import {
  getShopSales,
  getShopSalesCoverage,
  type ShopSales,
  type ShopSalesCoverage,
} from "@/lib/shop/sales";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateWarsaw, formatNumberPL, formatPlnWhole } from "@/lib/utils";

import { SettingsHeading } from "./settings-heading";
import { ShareCopyButton } from "./share-copy-button";
import { CopyTextButton } from "./copy-text-button";
import { ShopCsvUpload, ShopSalesKey } from "./shop-sales-client";

const DAY_MS = 86_400_000;
/** A push older than this means the shop's hourly job has stopped. */
const STALE_AFTER_HOURS = 3;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const last = n % 10;
  const lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

const EXAMPLE_JSON = `{
  "rows": [
    { "date": "2025-12-01", "market": "PL", "product": "Film od Mikołaja", "orders": 42, "revenue_pln": 2058.00, "pending_orders": 5, "pending_revenue_pln": 249.95 },
    { "date": "2025-12-01", "market": "DE", "product": "Film od Mikołaja", "orders": 9, "revenue_pln": 611.55 },
    { "date": "2025-12-01", "market": "PL", "product": "List od Mikołaja", "orders": 31, "revenue_pln": 1209.00 }
  ]
}`;

const EXAMPLE_CSV = `data;rynek;produkt;zamowienia;przychod_pln
2025-12-01;PL;Film od Mikołaja;42;2058,00
2025-12-01;DE;Film od Mikołaja;9;611,55
2025-12-01;PL;List od Mikołaja;31;1209,00`;

const CODE_BLOCK =
  "overflow-x-auto whitespace-pre rounded-[16px] bg-chip p-3 font-mono text-xs leading-relaxed text-foreground";

/**
 * "Panel sprzedażowy sklepu": the shop's own sales (orders, gross revenue per
 * day, market and product) next to ad spend, for MER. Agency only - rendered
 * inside the settings page, which already requires requireAgencyClientAccess;
 * every action re-checks it. Self-contained: reads its own data, so the page
 * only mounts it.
 */
export async function ShopSalesSettings({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const weekStart = isoDay(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS);

  let keyStatus: IngestKeyStatus;
  let coverage: ShopSalesCoverage;
  let week: ShopSales;
  try {
    [keyStatus, coverage, week] = await Promise.all([
      getIngestKeyStatus(createAdminClient(), clientId),
      getShopSalesCoverage(clientId),
      getShopSales(clientId, weekStart, today),
    ]);
  } catch (error) {
    console.error(`[settings] shop sales status for client ${clientId}:`, error);
    return (
      <Section>
        <Card className="max-w-2xl">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Nie udało się wczytać stanu sprzedaży sklepu. Odśwież stronę za chwilę.
          </CardContent>
        </Card>
      </Section>
    );
  }

  if (!keyStatus.available || !coverage.available || !week.available) {
    return (
      <Section>
        <Card className="max-w-2xl">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Najpierw uruchom{" "}
            <code className="rounded bg-muted px-1">supabase/migrations/ALL_RECENT_8.sql</code> w
            Supabase (SQL Editor), żeby włączyć sprzedaż ze sklepu.
          </CardContent>
        </Card>
      </Section>
    );
  }

  const key = keyStatus.key;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const endpoint = `${base}/api/ingest/sales`;
  const curl = `curl -X POST "${endpoint}" \\
  -H "Authorization: Bearer kal_live_TWOJ_KLUCZ" \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[{"date":"2025-12-01","market":"PL","product":"Film od Mikołaja","orders":42,"revenue_pln":2058.00}]}'`;

  const hoursSincePush = coverage.lastUsedAt
    ? (Date.now() - Date.parse(coverage.lastUsedAt)) / 3_600_000
    : null;
  const stale = key !== null && hoursSincePush !== null && hoursSincePush > STALE_AFTER_HOURS;

  const spanDays =
    coverage.minDate && coverage.maxDate
      ? Math.round((Date.parse(coverage.maxDate) - Date.parse(coverage.minDate)) / DAY_MS) + 1
      : 0;

  const weekOrders = week.days.reduce((s, d) => s + d.orders, 0);
  const weekRevenue = week.days.reduce((s, d) => s + d.revenue, 0);
  const hasData = coverage.minDate !== null;

  return (
    <Section>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Status + key */}
        <Card>
          <CardContent className="flex flex-col gap-5 pt-6">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Ostatnie dane z API</dt>
                <dd className="text-sm font-medium text-foreground">
                  {coverage.lastUsedAt
                    ? formatDateWarsaw(coverage.lastUsedAt, "d MMM yyyy, HH:mm")
                    : "jeszcze nic nie przyszło"}
                </dd>
                {coverage.lastUsedAt && coverage.lastRows !== null ? (
                  <dd className="text-xs text-muted-foreground">
                    {formatNumberPL(coverage.lastRows)}{" "}
                    {plural(coverage.lastRows, "wiersz", "wiersze", "wierszy")}
                  </dd>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Zakres danych</dt>
                <dd className="text-sm font-medium text-foreground">
                  {coverage.minDate && coverage.maxDate
                    ? `${formatDateWarsaw(coverage.minDate)} – ${formatDateWarsaw(coverage.maxDate)}`
                    : "brak danych"}
                </dd>
                {spanDays > 0 ? (
                  <dd className="text-xs text-muted-foreground">
                    {formatNumberPL(spanDays)} {plural(spanDays, "dzień", "dni", "dni")}
                  </dd>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Ostatnie 7 dni</dt>
                <dd className="text-sm font-medium text-foreground">
                  {formatPlnWhole(weekRevenue)}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {formatNumberPL(weekOrders)}{" "}
                  {plural(weekOrders, "zamówienie", "zamówienia", "zamówień")}
                </dd>
              </div>
            </dl>

            {week.byMarket.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Przychód z 7 dni wg rynku">
                {week.byMarket.map((m) => (
                  <li
                    key={m.market || "none"}
                    className="rounded-full bg-chip px-2.5 py-1 text-xs text-foreground"
                  >
                    <span className="font-medium">{m.market || "bez rynku"}</span>{" "}
                    <span className="text-muted-foreground">{formatPlnWhole(m.revenue)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {stale ? (
              <p className="flex items-start gap-1.5 rounded-[16px] bg-warning-soft/70 p-3 text-sm text-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                Sklep nie wysłał danych od {formatNumberPL(hoursSincePush ?? 0)} godz. - zwykle
                wysyła co godzinę. Sprawdź jego zadanie cykliczne.
              </p>
            ) : null}

            <div className="border-t border-line pt-5">
              <ShopSalesKey
                clientSlug={clientSlug}
                keyPrefix={key?.prefix ?? null}
                createdAtLabel={
                  key?.createdAt ? formatDateWarsaw(key.createdAt, "d MMM yyyy, HH:mm") : null
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* CSV history */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div>
              <p className="text-sm font-medium text-foreground">Import historii z pliku CSV</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Np. poprzedni sezon wyeksportowany z panelu sklepu. Wiersz o tej samej dacie, rynku i
                produkcie nadpisuje wcześniejsze liczby, więc plik można wczytać ponownie.
              </p>
            </div>
            <pre className={CODE_BLOCK}>{EXAMPLE_CSV}</pre>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                Separator średnik lub przecinek; nagłówki też po angielsku:{" "}
                <code className="rounded bg-muted px-1">date,market,product,orders,revenue_pln</code>.
              </li>
              <li>
                Data RRRR-MM-DD (lub DD.MM.RRRR), kwoty brutto w PLN z przecinkiem lub kropką.
                Puste linie pomijamy.
              </li>
              <li>Maks. 4 MB. Kodowanie UTF-8 albo Windows-1250 (zapis z Excela).</li>
              <li>
                Używaj tych samych kodów rynków i nazw produktów co API - inaczej te same dni
                policzą się dwa razy.
              </li>
            </ul>
            <ShopCsvUpload clientSlug={clientSlug} />
          </CardContent>
        </Card>
      </div>

      {/* Developer docs; open until the first data arrives, then out of the way. */}
      <Card>
        <CardContent className="pt-6">
          <details open={!hasData} className="group">
            <summary className="cursor-pointer select-none rounded-sm text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Instrukcja dla programisty sklepu (API)
            </summary>
            <div className="mt-4 flex max-w-3xl flex-col gap-4 text-sm text-foreground">
              <p>
                Wysyłaj co godzinę ostatnie 14 dni (zamówienia opłacone, wg daty złożenia
                zamówienia; kwoty brutto w PLN). 14 dni, bo płatności „kup teraz, zapłać później”
                spływają do 10 dni po zamówieniu. Każde wysłanie zastępuje w całości dni, które
                zawiera. API przyjmuje ostatnie 45 dni - starszą historię wgraj plikiem CSV poniżej.
              </p>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Adres
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 break-all rounded-full bg-chip px-4 py-2.5 font-mono text-xs">
                    POST {endpoint}
                  </code>
                  <ShareCopyButton url={endpoint} />
                </div>
                {base ? null : (
                  <p className="text-xs text-muted-foreground">
                    Poprzedź ścieżkę adresem panelu (przycisk „Kopiuj” zrobi to sam).
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Nagłówki
                </p>
                <pre className={CODE_BLOCK}>
                  {"Authorization: Bearer <klucz API>\nContent-Type: application/json"}
                </pre>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Treść (JSON)
                </p>
                <pre className={CODE_BLOCK}>{EXAMPLE_JSON}</pre>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>
                    <code>date</code> - dzień złożenia zamówienia, RRRR-MM-DD (czas polski). Najpóźniej
                    jutro, najwcześniej 45 dni wstecz.
                  </li>
                  <li>
                    <code>market</code> - kod kraju: PL, DE, IT, UK, FR, BR, US… (GB → UK, USA/COM →
                    US). Brak lub inny tekst = „bez rynku”.
                  </li>
                  <li>
                    <code>product</code> - nazwa produktu, maks. {PRODUCT_MAX} znaków, za każdym razem
                    taka sama. Brak = wszystkie produkty razem.
                  </li>
                  <li>
                    <code>orders</code> - liczba opłaconych zamówień (liczba całkowita ≥ 0).
                  </li>
                  <li>
                    <code>revenue_pln</code> - przychód brutto w PLN (inne waluty przelicz na PLN), np.
                    1234.50.
                  </li>
                  <li>
                    <code>pending_orders</code>, <code>pending_revenue_pln</code> (opcjonalne) -
                    zamówienia złożone tego dnia, jeszcze nieopłacone. Panel pokaże, ile sprzedaży
                    czeka na płatność.
                  </li>
                  <li>
                    Jeden wiersz = data + rynek + produkt; powtórzenia w jednym żądaniu sumujemy.
                    Każdy dzień w żądaniu zastępuje wszystko, co było zapisane dla tego dnia - wyślij
                    więc zawsze komplet wierszy dnia. Jeden dzień wysyłaj na jednym poziomie
                    szczegółów (albo z produktami, albo bez).
                  </li>
                  <li>
                    Maks. {formatNumberPL(MAX_API_ROWS)} wierszy i 2 MB na żądanie.
                  </li>
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Odpowiedzi
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>
                    <code>200</code>{" "}
                    <code>{`{"ok":true,"rows":3,"dates":["2025-12-01","2025-12-01"]}`}</code>
                  </li>
                  <li>
                    <code>400</code>{" "}
                    <code>{`{"ok":false,"error":"…","issues":[{"path":"rows.0.date","message":"…"}]}`}</code>{" "}
                    - nic nie zapisano, popraw wskazane pola.
                  </li>
                  <li>
                    <code>401</code> zły lub wyłączony klucz · <code>413</code> za duże żądanie ·{" "}
                    <code>429</code> więcej niż 120 żądań na godzinę · <code>5xx</code> ponów przy
                    następnym uruchomieniu.
                  </li>
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Przykład (curl)
                  </p>
                  <CopyTextButton text={curl} label="Kopiuj" />
                </div>
                <pre className={CODE_BLOCK}>{curl}</pre>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section id="sprzedaz-sklepu" aria-label="Sprzedaż sklepu" className="scroll-mt-32 space-y-4">
      <SettingsHeading
        kicker="Ustawienia · Sprzedaż"
        title="Panel sprzedażowy sklepu"
        description="Prawdziwa sprzedaż ze sklepu obok wydatków na reklamy: zamówienia i przychód per rynek i produkt. Meta i Google przypisują sobie te same zamówienia - sklep liczy każde raz, więc MER (przychód sklepu / wydatki na reklamy) jest uczciwy."
      />
      {children}
    </section>
  );
}
