import { decrypt } from "@/lib/integrations/encryption";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { getAdThumbnails } from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Visual verifier + diagnostic for creative sharpness. Renders each thumbnail
// with its real pixel size, and a top block that traces the video pipeline
// (rich query ok? video_id found? video node returns a frame?) so we can see
// exactly where video ads lose their sharp source. Agency only.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GRAPH = "https://graph.facebook.com/v21.0";

interface MetaAccount {
  id: string;
  selected?: boolean;
}

function html(body: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8">${body}`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  );
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

  // ---- Diagnostic: trace the video pipeline with a raw query -------------
  const diag: string[] = [];
  const RICH =
    "id,name,creative{id,object_type,image_url,thumbnail_url,video_id,object_story_spec}";
  let ads: Array<Record<string, any>> = [];
  try {
    const url = `${GRAPH}/${account.id}/ads?fields=${encodeURIComponent(
      RICH
    )}&limit=40&access_token=${access_token}`;
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok || body.error) {
      diag.push(
        `❌ Zapytanie RICH ODRZUCONE przez Meta: ${esc(
          body.error?.message
        )} (code ${esc(body.error?.code)})`
      );
    } else {
      ads = body.data ?? [];
      diag.push(`✅ Zapytanie RICH OK — ${ads.length} reklam pobranych.`);
    }
  } catch (e) {
    diag.push(`❌ Zapytanie RICH rzuciło wyjątek: ${esc((e as Error).message)}`);
  }

  const videoAds = ads.filter((a) => {
    const c = a.creative ?? {};
    return (
      c.object_type === "VIDEO" ||
      c.video_id ||
      c.object_story_spec?.video_data?.video_id
    );
  });
  const withId = videoAds.filter((a) => {
    const c = a.creative ?? {};
    return c.video_id || c.object_story_spec?.video_data?.video_id;
  });
  diag.push(
    `🎬 Reklam typu wideo w próbce: ${videoAds.length}, z tego z video_id: ${withId.length}.`
  );

  // Probe the video node for the first video ad that has an id.
  const sample = withId[0]?.creative;
  const sampleId =
    sample?.video_id ?? sample?.object_story_spec?.video_data?.video_id;
  if (sampleId) {
    try {
      const url = `${GRAPH}/${sampleId}?fields=${encodeURIComponent(
        "picture,thumbnails{uri,width,height,is_preferred}"
      )}&access_token=${access_token}`;
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body.error) {
        diag.push(
          `❌ Węzeł wideo (${esc(sampleId)}) ODMÓWIŁ: ${esc(
            body.error?.message
          )} (code ${esc(body.error?.code)})`
        );
      } else {
        const frames = body.thumbnails?.data ?? [];
        const maxW = frames.reduce(
          (m: number, f: any) => Math.max(m, f.width ?? 0),
          0
        );
        diag.push(
          `✅ Węzeł wideo OK — klatek: ${frames.length}, max szerokość: ${maxW}px, picture: ${
            body.picture ? "jest" : "brak"
          }.`
        );
      }
    } catch (e) {
      diag.push(
        `❌ Węzeł wideo rzucił wyjątek: ${esc((e as Error).message)}`
      );
    }
  } else {
    diag.push("⚠️ Brak video_id w próbce — nie ma czego odpytać w węźle wideo.");
  }

  // ---- Visual grid via the real production code --------------------------
  let thumbs = new Map<string, string>();
  try {
    thumbs = await getAdThumbnails(access_token, account.id);
  } catch (err) {
    diag.push(`❌ getAdThumbnails rzucił błąd: ${esc((err as Error).message)}`);
  }

  const { data: rows } = await admin
    .from("creatives")
    .select("ad_id, ad_name")
    .eq("client_id", access.clientId)
    .eq("provider", "meta_ads")
    .order("spend_minor_units", { ascending: false })
    .limit(12);

  const items = (rows ?? [])
    .map((r) => ({
      name: (r.ad_name as string) || (r.ad_id as string),
      url: thumbs.get(r.ad_id as string) ?? null,
    }))
    .filter((i) => i.url);

  const fallbackItems =
    items.length === 0
      ? [...thumbs.entries()].slice(0, 12).map(([adId, url]) => ({
          name: adId,
          url,
        }))
      : items;

  const cards = fallbackItems
    .map(
      (i) => `
    <div style="border:1px solid #ddd;border-radius:12px;padding:10px;width:230px">
      <div style="position:relative;height:150px;border-radius:8px;overflow:hidden;background:#f2f2f2">
        <img src="${esc(i.url)}" alt="" style="width:100%;height:100%;object-fit:cover"
             onload="var s=this.nextElementSibling;s.textContent=this.naturalWidth+'×'+this.naturalHeight+' px';s.style.background=(this.naturalWidth>=300?'#0a7':'#c22')"
             onerror="var s=this.nextElementSibling;s.textContent='błąd ładowania';s.style.background='#c22'">
        <span style="position:absolute;left:6px;top:6px;color:#fff;font:600 11px/1.4 sans-serif;padding:2px 6px;border-radius:6px;background:#888">…</span>
      </div>
      <p style="font:500 12px/1.4 sans-serif;margin:8px 0 0;word-break:break-word">${esc(i.name)}</p>
    </div>`
    )
    .join("");

  return html(`
    <div style="font-family:sans-serif;padding:20px;max-width:1100px;margin:0 auto">
      <h1 style="font-size:18px">Weryfikacja ostrości kreacji — ${esc(clientSlug)}</h1>
      <div style="background:#111;color:#eee;border-radius:10px;padding:14px 16px;font:13px/1.7 ui-monospace,monospace;margin:12px 0">
        <b>Diagnostyka wideo:</b><br>${diag.map(esc).join("<br>")}
      </div>
      <p style="color:#555;font-size:13px">
        Konto ${esc(account.id)} · ${fallbackItems.length} kreacji · miniatur pobranych: ${thumbs.size}.
        Zielona plakietka = źródło ≥300&nbsp;px (ostre). Czerwona = małe/rozmyte lub błąd.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:16px">${cards}</div>
    </div>`);
}
