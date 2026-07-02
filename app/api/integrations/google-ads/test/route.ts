import { NextResponse } from "next/server";

import {
  loadIntegration,
  type GoogleAdsCredentials,
} from "@/lib/integrations/credentials";
import { listAccessibleCustomers } from "@/lib/integrations/google-ads";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Test the stored Google Ads connection by listing accessible customers.
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
  const integration = await loadIntegration<GoogleAdsCredentials>(
    admin,
    access.clientId,
    "google_ads"
  );
  if (!integration) {
    return NextResponse.json({ ok: false, error: "Brak integracji Google Ads" });
  }

  try {
    const accounts = await listAccessibleCustomers(
      integration.credentials.refresh_token
    );
    return NextResponse.json({
      ok: true,
      accounts_count: accounts.length,
      sample: accounts.slice(0, 5).map((a) => a.name),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Token wygasł lub został odwołany — połącz ponownie",
    });
  }
}
