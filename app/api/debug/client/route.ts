import { decrypt } from "@/lib/integrations/encryption";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { hasClicksAllColumn } from "@/lib/integrations/link-clicks";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

// Client health diagnostic: what's connected, how many accounts are SELECTED,
// last sync per provider (with errors) and row counts - so we can see exactly
// why a client has no data. Agency only. /api/debug/client?client=sunew
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function html(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><div style="font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:860px;margin:0 auto;line-height:1.6">${body}</div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("client") ?? "";
  const admin = createAdminClient();

  if (!slug) return html("Podaj ?client=&lt;slug&gt;");
  const access = await requireAgencyClientAccess(slug);
  if (!access.ok) {
    // The slug list is a service-role read of EVERY client, and /api is outside
    // the middleware - so only an agency user who mistyped a slug (404) may see
    // it. Anonymous (401) and client users (403) must not enumerate tenants.
    const { data: cs } =
      access.status === 404
        ? await admin.from("clients").select("slug, name").order("name", { ascending: true })
        : { data: null };
    const reason =
      access.status === 401
        ? "Niezalogowany (401) - wejdz najpierw na /clients (zaloguj sie), potem otworz ten link w tej samej karcie."
        : access.status === 403
          ? "To konto nie jest agencyjne (403)."
          : `Nie ma klienta o slug "${esc(slug)}" (404).`;
    const list = (cs ?? [])
      .map((c) => `<code>${esc(c.slug)}</code> (${esc(c.name)})`)
      .join(" · ");
    return html(
      `<h2>Brak dostępu</h2><p>${reason}</p>${
        access.status === 404
          ? `<p style="margin-top:12px">Dostępni klienci (slug): ${list || "brak"}</p>`
          : ""
      }<p style="color:#64748b">Otwórz: <code>/api/debug/client?client=&lt;slug&gt;</code></p>`
    );
  }

  const cid = access.clientId;

  // ?ecom=1 / ?run=1 mutate on a GET, and Lax session cookies ride along on a
  // top-level navigation from another site - so a link sent to an agency user
  // could flip an engagement client to e-commerce (revenue/ROAS shown to a
  // client that must never see it). Only honour them when typed/bookmarked
  // ("none") or clicked inside the app ("same-origin").
  const fetchSite = request.headers.get("sec-fetch-site");
  const mutationsAllowed = !fetchSite || fetchSite === "none" || fetchSite === "same-origin";
  const blockedNote = mutationsAllowed
    ? ""
    : `<div style="background:#fee;padding:10px;border-radius:8px;margin:12px 0">Zmiany (ecom=1 / run=1) działają tylko po wklejeniu adresu w pasek przeglądarki, nie z linku z innej strony.</div>`;

  // Optional: flag this client as e-commerce (needs migration 0016 columns).
  let ecomReport = "";
  if (mutationsAllowed && new URL(request.url).searchParams.get("ecom") === "1") {
    const { error } = await admin
      .from("clients")
      .update({ client_type: "ecommerce" })
      .eq("id", cid);
    ecomReport = error
      ? `<div style="background:#fee;padding:10px;border-radius:8px;margin:12px 0">Nie mogę ustawić client_type='ecommerce': ${esc(error.message)} — najpierw uruchom migrację 0016 (dodaje kolumnę).</div>`
      : `<div style="background:#ecfdf5;padding:10px;border-radius:8px;margin:12px 0">✅ Ustawiono client_type='ecommerce' dla tego klienta.</div>`;
  }

  // Current client_type (defensive - column may not exist yet).
  const ctRes = await admin.from("clients").select("client_type").eq("id", cid).maybeSingle();
  const clientType = ctRes.error ? "brak kolumny (migracja 0016 nie uruchomiona)" : ((ctRes.data as { client_type?: string } | null)?.client_type ?? "engagement");

  // Revenue presence + sum.
  const revRes = await admin
    .from("ga4_daily")
    .select("revenue_minor_units, transactions")
    .eq("client_id", cid)
    .is("source_medium", null)
    .is("device_category", null)
    .is("page_path", null);
  let revLine: string;
  if (revRes.error) {
    revLine = `kolumny przychodu: <b>brak</b> (uruchom migrację 0016)`;
  } else {
    const totalRev = (revRes.data ?? []).reduce(
      (a, r) => a + Number((r as { revenue_minor_units?: number }).revenue_minor_units ?? 0),
      0
    );
    const totalTx = (revRes.data ?? []).reduce(
      (a, r) => a + Number((r as { transactions?: number }).transactions ?? 0),
      0
    );
    revLine = `kolumny przychodu: <b>są</b> · suma revenue: <b>${(totalRev / 100).toLocaleString("pl-PL")} zł</b> · transakcje: <b>${totalTx}</b>`;
  }

  // Optional: actually TRIGGER the sync for this client (server-side, with the
  // CRON_SECRET, using this request's own origin) - bypasses the UI button.
  let runReport = "";
  if (mutationsAllowed && new URL(request.url).searchParams.get("run") === "1") {
    const origin = new URL(request.url).origin;
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      runReport = `<p style="color:#b91c1c">Nie mogę odpalić syncu: brak CRON_SECRET w env.</p>`;
    } else {
      // Self-check: does the cron's exact query (by client_id) see the meta
      // integration from THIS process? Pinpoints an id mismatch vs a cron-path
      // issue.
      const { data: selfInt } = await admin
        .from("integrations")
        .select("provider, client_id")
        .eq("client_id", cid);
      const selfLine = `client_id = <code>${esc(cid)}</code> · bezpośrednie zapytanie integrations.eq(client_id) → ${
        selfInt?.length ?? 0
      } wierszy [${(selfInt ?? []).map((r) => esc(r.provider)).join(", ")}]`;

      const jobs = ["refresh-ads-meta", "refresh-ads-google", "refresh-ga4"];
      const results = await Promise.allSettled(
        jobs.map(async (job) => {
          const url = `${origin}/api/cron/${job}?client=${encodeURIComponent(cid)}`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${secret}` },
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          return `${job}: HTTP ${res.status} ${esc(JSON.stringify(body).slice(0, 300))}`;
        })
      );
      runReport = `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;margin:12px 0"><b>Uruchomiono sync:</b><br>${selfLine}<br><br>${results
        .map((r) =>
          r.status === "fulfilled" ? esc(r.value) : `błąd: ${esc(String(r.reason))}`
        )
        .join("<br>")}</div>`;
    }
  }

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

  // Meta clicks: link clicks (clicks) vs clicks (all) (clicks_all), last 30
  // days, plus how much history still waits for the one-time re-pull.
  let clicksLine: string;
  if (!(await hasClicksAllColumn(admin, "ads_daily"))) {
    clicksLine = `kolumna clicks_all: <b>brak</b> (uruchom migrację 0034) - kliknięcia Meta to nadal <b>wszystkie kliknięcia</b>`;
  } else {
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const since365 = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    try {
      const [rows, stale] = await Promise.all([
        fetchAll<{ clicks: number | null; clicks_all: number | null }>((from, to) =>
          admin
            .from("ads_daily")
            .select("clicks, clicks_all, date, campaign_id")
            .eq("client_id", cid)
            .eq("provider", "meta_ads")
            .gte("date", since30)
            .order("date", { ascending: true })
            .order("campaign_id", { ascending: true })
            .range(from, to)
        ),
        admin
          .from("ads_daily")
          .select("date", { count: "exact", head: true })
          .eq("client_id", cid)
          .eq("provider", "meta_ads")
          .gte("date", since365)
          .is("clicks_all", null),
      ]);
      const link = rows.reduce((a, r) => a + Number(r.clicks ?? 0), 0);
      const all = rows.reduce((a, r) => a + Number(r.clicks_all ?? r.clicks ?? 0), 0);
      clicksLine = `Meta, ostatnie 30 dni: kliknięcia linku <b>${link.toLocaleString("pl-PL")}</b> · wszystkie kliknięcia <b>${all.toLocaleString("pl-PL")}</b> · wierszy sprzed migracji 0034 (do ponownego pobrania, 365 dni): <b>${stale.count ?? 0}</b>`;
    } catch (err) {
      clicksLine = `błąd odczytu kliknięć: ${esc((err as Error).message)}`;
    }
  }

  return html(`
    <h1 style="font-size:20px">Diagnostyka klienta: ${esc(slug)}</h1>
    ${blockedNote}${ecomReport}
    <h2 style="font-size:15px;margin-top:20px">E-commerce</h2>
    <ul>
      <li>client_type: <b>${esc(clientType)}</b></li>
      <li>${revLine}</li>
    </ul>
    ${runReport}

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
      <li>${clicksLine}</li>
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
