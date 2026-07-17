import { NextResponse } from "next/server";

import {
  loadIntegration,
  type TikTokCredentials,
} from "@/lib/integrations/credentials";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { listAdvertisers } from "@/lib/integrations/tiktok";
import { createAdminClient } from "@/lib/supabase/admin";

interface TikTokAccount {
  id: string;
}

// Test the stored TikTok connection by listing advertisers.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientSlug = searchParams.get("client");
  if (!clientSlug) {
    return NextResponse.json({ ok: false, error: "Missing client" }, { status: 400 });
  }

  const access = await requireAgencyClientAccess(clientSlug);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Brak dostępu" }, { status: access.status });
  }

  const admin = createAdminClient();
  const integration = await loadIntegration<TikTokCredentials>(
    admin,
    access.clientId,
    "tiktok_ads"
  );
  if (!integration) {
    return NextResponse.json({ ok: false, error: "Brak integracji TikTok Ads" });
  }

  try {
    const ids = ((integration.accountIds ?? []) as TikTokAccount[]).map((a) => a.id);
    const advertisers = await listAdvertisers(
      integration.credentials.access_token,
      ids
    );
    return NextResponse.json({
      ok: true,
      accounts_count: advertisers.length,
      sample: advertisers.slice(0, 5).map((a) => a.name),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Token wygasł lub został odwołany - połącz ponownie",
    });
  }
}
