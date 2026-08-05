import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  buildTokenValues,
  getSegmentMonthData,
  type CampaignFilter,
} from "@/lib/report/segment-data";

// Segment preview for the OLX v3 report links (agency only): shows how many
// campaigns a name filter catches and the numbers that would fill the deck.
// ?client=olx&all_of=GOODS,CEP[&any_of=...][&month=YYYY-MM]
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:ui-sans-serif,system-ui;max-width:860px;margin:40px auto;line-height:1.6">${body}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) return html("Podaj <code>?client=slug&amp;all_of=GOODS,CEP</code>.");

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return html(`Brak dostępu (${access.status}).`);

  const split = (v: string | null) =>
    (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allOf = split(searchParams.get("all_of"));
  const anyOf = split(searchParams.get("any_of"));
  if (!allOf.length && !anyOf.length) {
    return html(
      `<h2>Podgląd segmentu raportu</h2>
       <p>Użycie: <code>?client=${esc(clientSlug)}&amp;all_of=GOODS,CEP</code> — pokaże ile kampanii łapie filtr i liczby, które wejdą do decka OLX v3.</p>`
    );
  }

  const monthParam = searchParams.get("month");
  const monthDate =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? new Date(`${monthParam}-15T00:00:00`)
      : undefined;
  const filter: CampaignFilter = { all_of: allOf, any_of: anyOf };
  const data = await getSegmentMonthData(access.clientId, filter, monthDate);
  const values = buildTokenValues(data);

  const log: string[] = [];
  log.push(
    `<h2>Segment: all_of=[${esc(allOf.join(", "))}] any_of=[${esc(anyOf.join(", "))}] · ${data.monthLabel}</h2>`
  );
  log.push(
    `Kampanii w segmencie: <b>${data.campaignCount}</b>. ${
      data.campaignCount === 0
        ? "⚠️ Filtr nie łapie żadnej nazwy kampanii - deck wyjdzie z N/A."
        : ""
    }`
  );
  log.push(
    `<table border="1" cellpadding="6" style="border-collapse:collapse;font-size:14px">` +
      `<tr><th align="left">metryka</th><th align="left">wartość</th></tr>` +
      Object.entries(values)
        .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`)
        .join("") +
      `</table>`
  );
  log.push(
    `<h3>Top kampanie w segmencie</h3><ol>` +
      data.topCampaigns
        .map(
          (c) =>
            `<li>${esc(c.name)} — ${(c.cost / 100).toLocaleString("pl-PL")} zł</li>`
        )
        .join("") +
      `</ol>`
  );
  log.push(
    `<p><a href="/api/report/olx-v3?client=${esc(clientSlug)}&all_of=${esc(allOf.join(","))}${
      anyOf.length ? `&any_of=${esc(anyOf.join(","))}` : ""
    }${monthParam ? `&month=${esc(monthParam)}` : ""}">⬇️ Pobierz deck OLX v3 dla tego segmentu</a></p>`
  );

  return html(log.join("<br>"));
}
