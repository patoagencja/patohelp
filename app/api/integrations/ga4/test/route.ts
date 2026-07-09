import { NextResponse } from "next/server";

import {
  loadIntegration,
  type GoogleAdsCredentials,
} from "@/lib/integrations/credentials";
import { listAccessibleProperties } from "@/lib/integrations/ga4";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { createAdminClient } from "@/lib/supabase/admin";

// Test the stored GA4 connection by listing accessible properties.
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
    "ga4"
  );
  if (!integration) {
    return NextResponse.json({ ok: false, error: "Brak integracji GA4" });
  }

  try {
    const properties = await listAccessibleProperties(
      integration.credentials.refresh_token
    );
    return NextResponse.json({
      ok: true,
      accounts_count: properties.length,
      sample: properties.slice(0, 5).map((p) => p.displayName),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Token wygasł lub został odwołany - połącz ponownie",
    });
  }
}
