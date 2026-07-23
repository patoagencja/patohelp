import { NextResponse } from "next/server";

import { decrypt } from "@/lib/integrations/encryption";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Diagnostic: dump the raw creative fields Meta returns for a few ads, so we
// can see which image source is actually populated (image_url vs story-spec vs
// video). Agency only. Visit /api/debug/creatives?client=olx while logged in.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface MetaAccount {
  id: string;
  selected?: boolean;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client") ?? "olx";
  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("credentials_encrypted, account_ids")
    .eq("client_id", access.clientId)
    .eq("provider", "meta_ads")
    .maybeSingle();

  if (!integration) {
    return NextResponse.json({ error: "Brak integracji Meta" }, { status: 404 });
  }

  const { access_token } = JSON.parse(
    decrypt(integration.credentials_encrypted as string)
  );
  const account = ((integration.account_ids ?? []) as MetaAccount[]).find(
    (a) => a.selected
  );
  if (!account) {
    return NextResponse.json({ error: "Brak wybranego konta" }, { status: 404 });
  }

  const fields =
    "id,name,creative{image_url,thumbnail_url,video_id,object_type,object_story_spec{link_data{picture,image_hash},video_data{image_url,video_id}}}";
  const url = `https://graph.facebook.com/v21.0/${account.id}/ads?fields=${encodeURIComponent(
    fields
  )}&limit=6&access_token=${access_token}`;

  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();

  if (!res.ok) {
    return NextResponse.json({ ok: false, status: res.status, body }, { status: 200 });
  }

  // Summarise which fields are present per ad.
  const summary = (body.data ?? []).map((ad: Record<string, any>) => {
    const c = ad.creative ?? {};
    const oss = c.object_story_spec ?? {};
    return {
      ad_name: ad.name,
      object_type: c.object_type,
      has_image_url: Boolean(c.image_url),
      has_thumbnail_url: Boolean(c.thumbnail_url),
      video_id: c.video_id ?? oss.video_data?.video_id ?? null,
      story_link_picture: oss.link_data?.picture ? "yes" : "no",
      story_video_image: oss.video_data?.image_url ? "yes" : "no",
      thumbnail_url: c.thumbnail_url ?? null,
      image_url: c.image_url ?? null,
    };
  });

  return NextResponse.json({ account: account.id, count: summary.length, summary });
}
