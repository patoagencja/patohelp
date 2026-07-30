import { decrypt } from "@/lib/integrations/encryption";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Client health diagnostic: what's connected, how many accounts are SELECTED,
// last sync per provider (with errors) and row counts - so we can see exactly
// why a client has no data. Agency only. /api/debug/client?client=miracle
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function html(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><div style="font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:860px;margin:0 auto;line-height:1.6">${body}</div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("client") ?? "";
  if (!slug) return html("Podaj ?client=&lt;slug&gt;");
  const access = await requireAgencyClientAccess(slug);
  if (!access.ok) return html(`Brak dostępu (${access.status}).`);

  const admin = createAdminClient();
  const cid = access.clientId;

  // Integrations.
  const { data: integrations } = await admin
    .from("integrations")
    .select("provider, account_ids, credentials_encrypted, updated_at")
    .eq("client_id", cid);

  const intRows = (integrations ?? []).map((it) => {
    const provider = it.provider as string;
    let credsOk = false;
    try {
      JSON.parse(decrypt(it.credentials_encrypted as string));
      credsOk = true;
    } catch {
      credsOk = false;
    }
    const acc = (it.account_ids ?? {}) as any;
    let summary = "";
    if (provider === "ga4") {
      summary = acc.propertyId ? `propertyId=${esc(acc.propertyId)}` : "⚠️ brak propertyId";
    } else {
      const list = Array.isArray(acc) ? acc : Array.isArray(acc.accounts) ? acc.accounts : [];
      const selected = list.filter((a: any) => a?.selected === true).length;
      summary =
        list.length === 0
          ? "⚠️ brak kont w account_ids"
          : selected === 0
            ? `⚠️ ${list.length} kont, ale ZAZNACZONYCH: 0`
            : `${selected}/${list.length} kont zaznaczonych`;
    }
    return `<tr>
      <td style="padding:6px 10px;font-weight:600">${esc(provider)}</td>
      <td style="padding:6px 10px">${summary}</td>
      <td style="padding:6px 10px">${credsOk ? "✅ creds OK" : "❌ creds"}</td>
    </tr>`;
  });

  // Last sync per provider.
  const { data: runs } = await admin
    .from("sync_runs")
    .select("provider, status, error_message, started_at")
    .eq("client_id", cid)
    .order("started_at", { ascending: false })
    .limit(12);

  const runRows = (runs ?? []).map(
    (r) => `<tr>
      <td style="padding:4px 10px">${esc(r.provider)}</td>
      <td style="padding:4px 10px">${r.status === "success" ? "✅" : r.status === "failed" ? "❌" : "⏳"} ${esc(r.status)}</td>
      <td style="padding:4px 10px;color:#b91c1c">${esc(r.error_message ?? "")}</td>
      <td style="padding:4px 10px;color:#64748b;white-space:nowrap">${esc(String(r.started_at).slice(0, 16))}</td>
    </tr>`
  );

  // Row counts.
  const [ads, ga4, cre] = await Promise.all([
    admin.from("ads_daily").select("date", { count: "exact", head: false }).eq("client_id", cid).order("date", { ascending: false }).limit(1),
    admin.from("ga4_daily").select("date", { count: "exact", head: false }).eq("client_id", cid).order("date", { ascending: false }).limit(1),
    admin.from("creatives").select("ad_id", { count: "exact", head: true }).eq("client_id", cid),
  ]);

  return html(`
    <h1 style="font-size:20px">Diagnostyka klienta: ${esc(slug)}</h1>

    <h2 style="font-size:15px;margin-top:20px">Integracje</h2>
    ${
      intRows.length
        ? `<table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px">${intRows.join("")}</table>`
        : "<p>❌ Brak jakichkolwiek integracji dla tego klienta - trzeba podłączyć Meta/Google/GA4 w Ustawieniach.</p>"
    }

    <h2 style="font-size:15px;margin-top:20px">Dane w bazie</h2>
    <ul>
      <li>ads_daily: <b>${ads.count ?? 0}</b> wierszy${(ads.data?.[0]?.date) ? `, najnowszy: ${esc(ads.data[0].date)}` : ""}</li>
      <li>ga4_daily: <b>${ga4.count ?? 0}</b> wierszy${(ga4.data?.[0]?.date) ? `, najnowszy: ${esc(ga4.data[0].date)}` : ""}</li>
      <li>creatives: <b>${cre.count ?? 0}</b> wierszy</li>
    </ul>

    <h2 style="font-size:15px;margin-top:20px">Ostatnie synchronizacje</h2>
    ${
      runRows.length
        ? `<table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px">${runRows.join("")}</table>`
        : "<p>Brak przebiegów synchronizacji - kliknij Odswiez na panelu klienta, zeby ja uruchomic.</p>"
    }

    <p style="margin-top:20px;color:#64748b;font-size:13px">
      Najczęstsza przyczyna „pusto po podłączeniu": integracja jest, ale <b>ZAZNACZONYCH kont: 0</b> - wróć do Ustawień i wybierz konta/property, potem „Odśwież".
    </p>`);
}
