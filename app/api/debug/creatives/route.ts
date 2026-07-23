import { decrypt } from "@/lib/integrations/encryption";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { getAdThumbnails } from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Visual verifier for creative sharpness. Runs the REAL getAdThumbnails live
// (same code the sync uses) and renders each thumbnail with its actual pixel
// dimensions, so you can see at a glance whether the fix produces sharp images
// - no JSON to read. Agency only. Open /api/debug/creatives?client=olx while
// logged in.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface MetaAccount {
  id: string;
  selected?: boolean;
}

function html(body: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8">${body}`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client") ?? "olx";
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return html(`<p style="font-family:sans-serif">Brak dostępu (${access.status}).</p>`);
  }

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("credentials_encrypted, account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", "meta_ads")
    .maybeSingle();

  if (!integration) {
    return html(`<p style="font-family:sans-serif">Brak integracji Meta.</p>`);
  }

  const { access_token } = JSON.parse(
    decrypt(integration.credentials_encrypted as string)
  );
  const account = ((integration.account_ids ?? []) as MetaAccount[]).find(
    (a) => a.selected
  );
  if (!account) {
    return html(`<p style="font-family:sans-serif">Brak wybranego konta.</p>`);
  }

  let thumbs: Map<string, string>;
  try {
    thumbs = await getAdThumbnails(access_token, account.id);
  } catch (err) {
    return html(
      `<p style="font-family:sans-serif;color:#b00">getAdThumbnails rzucił błąd:<br><pre>${String(
        (err as Error).message
      )}</pre></p>`
    );
  }

  // Show the highest-spend ads so this matches the Kreacje podium the user sees.
  const { data: rows } = await admin
    .from("creatives")
    .select("ad_id, ad_name")
    .eq("client_id", access.clientId)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(12);

  const items = (rows ?? [])
    .map((r) => ({
      adId: r.ad_id as string,
      name: (r.ad_name as string) || (r.ad_id as string),
      url: thumbs.get(r.ad_id as string) ?? null,
    }))
    .filter((i) => i.url);

  // If the DB is empty for some reason, fall back to whatever the live map has.
  const fallbackItems =
    items.length === 0
      ? [...thumbs.entries()].slice(0, 12).map(([adId, url]) => ({
          adId,
          name: adId,
          url,
        }))
      : items;

  const cards = fallbackItems
    .map(
      (i) => `
    <div style="border:1px solid #ddd;border-radius:12px;padding:10px;width:230px">
      <div style="position:relative;height:150px;border-radius:8px;overflow:hidden;background:#f2f2f2">
        <img src="${i.url}" alt="" style="width:100%;height:100%;object-fit:cover"
             onload="var s=this.nextElementSibling;s.textContent=this.naturalWidth+'×'+this.naturalHeight+' px';s.style.background=(this.naturalWidth>=300?'#0a7':'#c22')"
             onerror="var s=this.nextElementSibling;s.textContent='błąd ładowania';s.style.background='#c22'">
        <span style="position:absolute;left:6px;top:6px;color:#fff;font:600 11px/1.4 sans-serif;padding:2px 6px;border-radius:6px;background:#888">…</span>
      </div>
      <p style="font:500 12px/1.4 sans-serif;margin:8px 0 0;word-break:break-word">${i.name}</p>
    </div>`
    )
    .join("");

  return html(`
    <div style="font-family:sans-serif;padding:20px;max-width:1100px;margin:0 auto">
      <h1 style="font-size:18px">Weryfikacja ostrości kreacji — ${clientSlug}</h1>
      <p style="color:#555;font-size:13px">
        Konto ${account.id} · ${fallbackItems.length} kreacji · liczba pobranych miniatur: ${thumbs.size}.<br>
        Zielona plakietka = źródło ≥300&nbsp;px (ostre). Czerwona = małe/rozmyte lub błąd.
        To są obrazki pobrane <b>na żywo aktualnym kodem</b> — jeśli są ostre, kliknij „Odśwież" w Kreacjach, żeby zapisać je w bazie.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:16px">${cards}</div>
    </div>`);
}
