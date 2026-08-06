import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { decrypt } from "@/lib/integrations/encryption";
import {
  getDailyMetrics,
  getItemsDaily,
  getNewVsReturning,
  getSessionsByDevice,
  getSessionsBySourceMedium,
  getTopPages,
  type DateRange,
} from "@/lib/integrations/ga4";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Diagnostic + one-shot writer for GA4. Runs a live report AND performs the
// full ga4_daily write for one client, reporting inserted rows or the exact DB
// error - so we can see why the Witryna tab stays empty. Agency only.
// Open /api/debug/ga4?client=olx while logged in.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WARSAW_TZ = "Europe/Warsaw";

function html(body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><div style="font-family:sans-serif;padding:24px;max-width:820px;margin:0 auto;line-height:1.6">${body}</div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

export async function GET(request: Request) {
  const clientSlug = new URL(request.url).searchParams.get("client") ?? "olx";
  const admin = createAdminClient();

  // Auth: an agency session, OR a CRON_SECRET bearer (so it can be checked
  // server-to-server without a login).
  const secret = process.env.CRON_SECRET;
  const bearerOk =
    !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
  let clientId: string;
  if (bearerOk) {
    const { data: c } = await admin
      .from("clients")
      .select("id")
      .eq("slug", clientSlug)
      .maybeSingle();
    if (!c) return html(`Nie ma klienta o slug "${esc(clientSlug)}".`);
    clientId = c.id as string;
  } else {
    const access = await requireAgencyClientAccess(clientSlug);
    if (!access.ok) return html(`Brak dostępu (${access.status}).`);
    clientId = access.clientId;
  }
  const { data: integration } = await admin
    .from("integrations")
    .select("credentials_encrypted, account_ids")
    .eq("client_id", clientId)
    .eq("provider", "ga4")
    .maybeSingle();
  if (!integration) return html("Brak integracji GA4 dla tego klienta.");

  const propertyId = (integration.account_ids as { propertyId?: string })?.propertyId;
  if (!propertyId) return html("Brak zapisanego <b>propertyId</b> w account_ids.");

  const { refresh_token } = JSON.parse(decrypt(integration.credentials_encrypted as string));
  if (!refresh_token) return html("Brak <b>refresh_token</b> - połącz GA4 ponownie.");

  const now = new Date();
  const until = formatInTimeZone(now, WARSAW_TZ, "yyyy-MM-dd");
  // Daily totals can be backfilled arbitrarily far with ?days=N (default 30,
  // capped at 365) - lets us pull months of revenue history on demand. The
  // dimension snapshots stay a fixed 30-day window (that is what the report
  // widgets represent).
  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const backfillDays =
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
  const dailyStart = formatInTimeZone(
    subDays(now, backfillDays - 1),
    WARSAW_TZ,
    "yyyy-MM-dd"
  );
  const snapshotStart = formatInTimeZone(subDays(now, 29), WARSAW_TZ, "yyyy-MM-dd");
  const dailyRange: DateRange = { startDate: dailyStart, endDate: until };
  const snapshotRange: DateRange = { startDate: snapshotStart, endDate: until };

  const log: string[] = [];

  // 1) Fetch (report per-call so we see which one, if any, fails).
  let daily, sourceMedium, devices, pages, newReturning;
  try {
    daily = await getDailyMetrics(refresh_token, propertyId, dailyRange);
    const liveRevenue = daily.reduce((a, d) => a + (d.revenue ?? 0), 0);
    const livePurchase = daily.reduce((a, d) => a + (d.purchaseRevenue ?? 0), 0);
    const liveTx = daily.reduce((a, d) => a + (d.transactions ?? 0), 0);
    log.push(`✅ getDailyMetrics: ${daily.length} dni`);
    log.push(
      `💰 GA4 NA ŻYWO (${backfillDays} dni): przychód = <b>${liveRevenue.toLocaleString(
        "pl-PL"
      )} zł</b>, transakcje = <b>${liveTx}</b> ${
        liveRevenue === 0 && liveTx === 0
          ? "→ ⚠️ property NIE zwraca przychodu (totalRevenue=0). To konfiguracja e-commerce w GA4 po stronie sklepu, nie panelu."
          : "→ ✅ GA4 ma sprzedaż; po Odśwież wejdzie do panelu."
      }`
    );
    log.push(
      `🔎 rozbicie: totalRevenue = <b>${liveRevenue.toLocaleString(
        "pl-PL"
      )} zł</b>, purchaseRevenue = <b>${livePurchase.toLocaleString(
        "pl-PL"
      )} zł</b> ${
        liveRevenue > 0 && livePurchase === 0
          ? "→ sprzedaż liczona przez zdarzenie inne niż standardowy <code>purchase</code> (dlatego wcześniej było 0)."
          : ""
      }`
    );
    // Per-month split so we can see from which month GA4 actually returns
    // revenue - answers "did tracking work earlier or only from August?".
    const byMonth = new Map<string, { rev: number; tx: number }>();
    for (const d of daily) {
      const m = d.date.slice(0, 7); // YYYY-MM
      const cur = byMonth.get(m) ?? { rev: 0, tx: 0 };
      cur.rev += d.revenue ?? 0;
      cur.tx += d.transactions ?? 0;
      byMonth.set(m, cur);
    }
    const monthly = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([m, v]) =>
          `${m}: <b>${Math.round(v.rev).toLocaleString("pl-PL")} zł</b> (${v.tx} tx)`
      )
      .join(" · ");
    log.push(`📅 przychód wg miesięcy (GA4 na żywo): ${monthly || "brak"}`);
  } catch (e) {
    return html(`❌ getDailyMetrics padło:<pre style="white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:8px">${esc((e as Error).message)}</pre>`);
  }
  try {
    [sourceMedium, devices, pages, newReturning] = await Promise.all([
      getSessionsBySourceMedium(refresh_token, propertyId, snapshotRange),
      getSessionsByDevice(refresh_token, propertyId, snapshotRange),
      getTopPages(refresh_token, propertyId, snapshotRange, 10),
      getNewVsReturning(refresh_token, propertyId, snapshotRange),
    ]);
    log.push(
      `✅ snapshoty: source=${sourceMedium.length}, device=${devices.length}, pages=${pages.length}`
    );
  } catch (e) {
    return html(`Daily OK, ale snapshoty padły:<pre style="white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:8px">${esc((e as Error).message)}</pre>`);
  }

  // 2) Build rows exactly like the cron.
  const newUsers = newReturning.find((r) => r.type === "new")?.sessions ?? 0;
  const returningUsers = newReturning.find((r) => r.type === "returning")?.sessions ?? 0;
  const rows: Record<string, unknown>[] = [];
  for (const d of daily) {
    rows.push({
      client_id: clientId,
      date: d.date,
      sessions: d.sessions,
      users_new: d.date === until ? newUsers : 0,
      users_returning: d.date === until ? returningUsers : 0,
      engagement_rate: d.engagementRate,
      revenue_minor_units: Math.round((d.revenue ?? 0) * 100),
      transactions: Math.round(d.transactions ?? 0),
      source_medium: null,
      device_category: null,
      page_path: null,
      page_views: 0,
    });
  }
  for (const s of sourceMedium) rows.push({ client_id: clientId, date: until, sessions: s.sessions, users_new: 0, users_returning: 0, engagement_rate: s.engagementRate, source_medium: s.sourceMedium, page_views: 0 });
  for (const dv of devices) rows.push({ client_id: clientId, date: until, sessions: dv.sessions, users_new: 0, users_returning: 0, device_category: dv.deviceCategory, page_views: 0 });
  for (const p of pages) rows.push({ client_id: clientId, date: until, sessions: 0, users_new: 0, users_returning: 0, engagement_rate: p.engagementRate, page_path: p.pagePath, page_views: p.pageViews });
  // Homogenize: PostgREST fills keys a row is missing with explicit NULL, so
  // the NOT NULL revenue/transactions columns must appear on the snapshot rows
  // too (they carry no revenue).
  for (const r of rows) {
    if (r.revenue_minor_units == null) r.revenue_minor_units = 0;
    if (r.transactions == null) r.transactions = 0;
  }
  log.push(`ℹ️ zbudowano ${rows.length} wierszy do zapisu`);

  // 3) Write (delete window + insert), reporting the exact DB error.
  const { error: delErr } = await admin
    .from("ga4_daily")
    .delete()
    .eq("client_id", clientId)
    .gte("date", dailyRange.startDate)
    .lte("date", until);
  if (delErr) return html(`${log.join("<br>")}<br><br>❌ DELETE padł:<pre style="white-space:pre-wrap;background:#fee;padding:12px;border-radius:8px">${esc(delErr.message)}</pre>`);

  const { error: insErr } = await admin.from("ga4_daily").insert(rows);
  if (insErr) {
    return html(
      `${log.join("<br>")}<br><br>❌ <b>INSERT padł</b> - to jest przyczyna:<pre style="white-space:pre-wrap;background:#fee;padding:12px;border-radius:8px">${esc(insErr.message)}</pre>`
    );
  }

  // 3b) Per-SKU sales for the same window (needs migration 0018's table).
  const itemsProbe = await admin.from("ga4_items_daily").select("id").limit(1);
  if (itemsProbe.error) {
    log.push(
      "🛍️ produkty (SKU): pominięte - brak tabeli ga4_items_daily (migracja 0018)."
    );
  } else {
    try {
      const items = await getItemsDaily(refresh_token, propertyId, dailyRange);
      await admin
        .from("ga4_items_daily")
        .delete()
        .eq("client_id", clientId)
        .gte("date", dailyRange.startDate)
        .lte("date", until);
      for (let i = 0; i < items.length; i += 1000) {
        const { error } = await admin.from("ga4_items_daily").insert(
          items.slice(i, i + 1000).map((it) => ({
            client_id: clientId,
            date: it.date,
            item_id: it.itemId,
            item_name: it.itemName,
            quantity: it.quantity,
            revenue_minor_units: Math.round(it.revenue * 100),
          }))
        );
        if (error) throw new Error(error.message);
      }
      log.push(`🛍️ produkty (SKU): zapisano ${items.length} wierszy.`);
    } catch (e) {
      log.push(`🛍️ produkty (SKU): ❌ ${esc((e as Error).message)}`);
    }
  }

  // 4) Confirm what's now in the DB.
  const { count } = await admin
    .from("ga4_daily")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("date", snapshotStart)
    .lte("date", until);

  return html(
    `<h2 style="color:#0a7">✅ Zapisano dane GA4 do bazy</h2>
     ${log.join("<br>")}<br><br>
     Wierszy w ga4_daily (ostatnie 30 dni): <b>${count ?? "?"}</b>.<br><br>
     Wejdź teraz w <b>Witryna</b> i odśwież - dane powinny być widoczne. Jeśli tu zadziałało, a cron nie zapisywał, to znaczy że zbiorczy cron nie dochodził do OLX (naprawię to osobno).`
  );
}
