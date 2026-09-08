import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Raw sync history per provider - the ground truth behind the health banner.
// Shows what actually ran, when, and with what error, so an integration that
// "looks connected but isn't syncing" names its own cause instead of being
// guessed at. Agency only. /api/debug/sync?client=sunew
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = (body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:ui-sans-serif,system-ui;max-width:1000px;margin:40px auto;line-height:1.6">${body}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );

export async function GET(request: Request) {
  const clientSlug = new URL(request.url).searchParams.get("client");
  if (!clientSlug) return html("Podaj <code>?client=slug</code>.");

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) return html(`Brak dostępu (${access.status}).`);

  const admin = createAdminClient();
  const out: string[] = [`<h2>Sync – ${esc(clientSlug)}</h2>`];

  // What is actually connected, and does GA4 have a property chosen?
  const { data: integrations } = await admin
    .from("integrations")
    .select("provider, account_ids, credentials_encrypted, updated_at")
    .eq("client_id", access.clientId);

  out.push("<h3>Integracje</h3><ul>");
  for (const i of integrations ?? []) {
    const ids = (i.account_ids ?? {}) as Record<string, unknown>;
    const propertyId = ids.propertyId ? String(ids.propertyId) : null;
    const hasCreds = Boolean(i.credentials_encrypted);
    out.push(
      `<li><b>${esc(String(i.provider))}</b> — token zapisany: <b>${hasCreds ? "TAK" : "NIE"}</b>` +
        (i.provider === "ga4"
          ? ` · propertyId: <b>${propertyId ? esc(propertyId) : "BRAK (dokończ wybór property)"}</b>`
          : "") +
        (i.updated_at
          ? ` · zaktualizowano: ${esc(String(i.updated_at).slice(0, 16).replace("T", " "))}`
          : "") +
        `</li>`
    );
  }
  out.push("</ul>");

  // Last 25 runs per provider - the actual timeline.
  const { data: runs } = await admin
    .from("sync_runs")
    .select("provider, status, started_at, finished_at, error_message")
    .eq("client_id", access.clientId)
    .order("started_at", { ascending: false })
    .limit(120);

  const byProvider = new Map<string, typeof runs>();
  for (const r of runs ?? []) {
    const key = String(r.provider);
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key)!.push(r);
  }

  out.push("<h3>Ostatnie przebiegi (sync_runs)</h3>");
  if (!byProvider.size) {
    out.push(
      "<p>⚠️ Brak jakichkolwiek wpisów — cron w ogóle nie dociera do tego klienta.</p>"
    );
  }
  for (const [provider, list] of byProvider) {
    const rows = (list ?? [])
      .slice(0, 10)
      .map((r) => {
        const when = String(r.started_at ?? "").slice(0, 16).replace("T", " ");
        const color =
          r.status === "success" ? "#0a7" : r.status === "failed" ? "#c00" : "#888";
        return `<tr><td>${esc(when)}</td><td style="color:${color}"><b>${esc(String(r.status))}</b></td><td>${esc(String(r.error_message ?? ""))}</td></tr>`;
      })
      .join("");
    const lastSuccess = (list ?? []).find((r) => r.status === "success");
    out.push(
      `<h4>${esc(provider)}</h4>` +
        `<p>Ostatni sukces: <b>${lastSuccess ? esc(String(lastSuccess.finished_at ?? lastSuccess.started_at).slice(0, 16).replace("T", " ")) : "BRAK w ostatnich wpisach"}</b></p>` +
        `<table border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px">` +
        `<tr><th align="left">start</th><th align="left">status</th><th align="left">błąd</th></tr>${rows}</table>`
    );
  }

  return html(out.join(""));
}
