import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { decrypt } from "@/lib/integrations/encryption";
import { getDailyMetrics } from "@/lib/integrations/ga4";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Diagnostic: run a live GA4 report for a client and show the exact result or
// the exact error (e.g. "Analytics Data API not enabled"). Agency only.
// Open /api/debug/ga4?client=olx while logged in.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function html(body: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><div style="font-family:sans-serif;padding:24px;max-width:800px;margin:0 auto;line-height:1.6">${body}</div>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

export async function GET(request: Request) {
  const clientSlug = new URL(request.url).searchParams.get("client") ?? "olx";
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return html(`Brak dostępu (${access.status}).`);

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("credentials_encrypted, account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", "ga4")
    .maybeSingle();

  if (!integration) return html("Brak integracji GA4 dla tego klienta.");

  const propertyId = (integration.account_ids as { propertyId?: string })?.propertyId;
  if (!propertyId) return html("Integracja GA4 istnieje, ale brak zapisanego <b>propertyId</b> w account_ids.");

  let creds: { refresh_token?: string };
  try {
    creds = JSON.parse(decrypt(integration.credentials_encrypted as string));
  } catch (e) {
    return html(`Nie udało się odszyfrować poświadczeń GA4: <pre>${esc((e as Error).message)}</pre>`);
  }
  if (!creds.refresh_token) {
    return html("Brak <b>refresh_token</b> w poświadczeniach GA4 - trzeba ponownie połączyć GA4 (OAuth).");
  }

  const now = new Date();
  const range = {
    startDate: formatInTimeZone(subDays(now, 7), "Europe/Warsaw", "yyyy-MM-dd"),
    endDate: formatInTimeZone(now, "Europe/Warsaw", "yyyy-MM-dd"),
  };

  try {
    const daily = await getDailyMetrics(creds.refresh_token, propertyId, range);
    const total = daily.reduce((a, d) => a + d.sessions, 0);
    if (!daily.length || total === 0) {
      return html(
        `<h2>GA4 odpowiada, ale zwraca 0 sesji</h2>
         Property: <b>${esc(propertyId)}</b>, zakres ${range.startDate} - ${range.endDate}.<br>
         API działa (brak błędu), ale nie ma danych. Najczęściej: to nowe/puste property, złe property ID, albo dane jeszcze nie spłynęły.`
      );
    }
    return html(
      `<h2 style="color:#0a7">✅ GA4 działa</h2>
       Property <b>${esc(propertyId)}</b> zwrócił dane. Suma sesji (7 dni): <b>${total}</b>.<br>
       Dni: ${daily.map((d) => `${d.date}=${d.sessions}`).join(", ")}<br><br>
       Skoro live-zapytanie działa, wystarczy kliknąć „Odśwież" - dane zapiszą się do bazy.`
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return html(
      `<h2 style="color:#c22">❌ GA4 zwrócił błąd</h2>
       Property: <b>${esc(propertyId)}</b><br><br>
       <pre style="white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:8px">${esc(msg)}</pre>
       <p>Jeśli błąd mówi o „Google Analytics Data API has not been used / disabled" - trzeba włączyć <b>Google Analytics Data API</b> w Google Cloud (w projekcie, z którego pochodzą GOOGLE_* poświadczenia).</p>`
    );
  }
}
