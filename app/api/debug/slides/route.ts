import { decrypt } from "@/lib/integrations/encryption";
import { listPlaceholders } from "@/lib/integrations/google-slides";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  buildTokenValues,
  getSegmentMonthData,
  type CampaignFilter,
} from "@/lib/report/segment-data";
import { createAdminClient } from "@/lib/supabase/admin";

// Setup helper for the Slides report automation (agency only). Shows, in the
// browser:
//   - the {{tokens}} found in a template deck vs the tokens we can fill
//   - a preview of segment numbers for a given campaign filter
// ?client=olx&template_file=<slides file id>   -> token audit
// ?client=olx&all_of=GOODS,CEP[&month=YYYY-MM] -> segment numbers preview
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
  if (!clientSlug) return html("Podaj <code>?client=slug</code>.");

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return html(`Brak dostępu (${access.status}).`);

  const admin = createAdminClient();
  const log: string[] = [];

  // Filter preview: numbers the tokens would carry for this segment.
  const allOf = (searchParams.get("all_of") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const anyOf = (searchParams.get("any_of") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allOf.length || anyOf.length) {
    const monthParam = searchParams.get("month");
    const monthDate =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? new Date(`${monthParam}-15T00:00:00`)
        : undefined;
    const filter: CampaignFilter = { all_of: allOf, any_of: anyOf };
    const data = await getSegmentMonthData(access.clientId, filter, monthDate);
    const values = buildTokenValues(data);
    log.push(
      `<h2>Segment: all_of=[${allOf.join(", ")}] any_of=[${anyOf.join(", ")}] · ${data.monthLabel}</h2>`
    );
    log.push(
      `Kampanii w segmencie: <b>${data.campaignCount}</b>. Jeśli 0 - filtr nie łapie żadnej nazwy kampanii.`
    );
    log.push(
      `<table border="1" cellpadding="6" style="border-collapse:collapse;font-size:14px">` +
        `<tr><th align="left">token</th><th align="left">wartość</th></tr>` +
        Object.entries(values)
          .map(
            ([k, v]) =>
              `<tr><td><code>{{${esc(k)}}}</code></td><td>${esc(v)}</td></tr>`
          )
          .join("") +
        `</table>`
    );
    log.push(
      `<h3>Top kampanie w segmencie</h3><ol>` +
        data.topCampaigns
          .map((c) => `<li>${esc(c.name)} — ${(c.cost / 100).toLocaleString("pl-PL")} zł</li>`)
          .join("") +
        `</ol>`
    );
  }

  // Template audit: which {{tokens}} does the deck use, which will fill?
  const templateFile = searchParams.get("template_file");
  if (templateFile) {
    const { data: integ } = await admin
      .from("integrations")
      .select("credentials_encrypted")
      .eq("client_id", access.clientId)
      .eq("provider", "google_slides")
      .single();
    if (!integ?.credentials_encrypted) {
      log.push("❌ Google Slides nie połączony dla tego klienta.");
    } else {
      const { refresh_token } = JSON.parse(
        decrypt(integ.credentials_encrypted as string)
      );
      const found = await listPlaceholders(refresh_token, templateFile);
      const sample = buildTokenValues(
        await getSegmentMonthData(access.clientId, { all_of: [], any_of: [] })
      );
      const known = new Set(Object.keys(sample));
      log.push(`<h2>Tokeny w decku <code>${esc(templateFile)}</code></h2>`);
      if (!found.length) {
        log.push(
          "⚠️ Deck nie zawiera żadnych <code>{{tokenów}}</code>. Zamień liczby w szablonie na tokeny, np. <code>{{spend}}</code>."
        );
      } else {
        log.push(
          `<ul>` +
            found
              .map(
                (t) =>
                  `<li><code>{{${esc(t)}}}</code> ${
                    known.has(t)
                      ? "✅ wypełnimy"
                      : "❌ nieznany token (literówka?)"
                  }</li>`
              )
              .join("") +
            `</ul>`
        );
      }
      log.push(
        `<h3>Wszystkie dostępne tokeny</h3><p style="font-size:13px">${[...known]
          .sort()
          .map((t) => `<code>{{${esc(t)}}}</code>`)
          .join(" · ")}</p>`
      );
    }
  }

  if (!log.length) {
    log.push(
      `<h2>Slides report debug</h2>
       <p>Użycie:</p>
       <ul>
         <li><code>?client=olx&amp;all_of=GOODS,CEP</code> - podgląd liczb segmentu (poprz. miesiąc)</li>
         <li><code>?client=olx&amp;template_file=&lt;id pliku Slides&gt;</code> - audyt tokenów w szablonie</li>
       </ul>`
    );
  }

  return html(log.join("<br>"));
}
