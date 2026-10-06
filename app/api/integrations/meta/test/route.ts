import { NextResponse } from "next/server";

import {
  loadIntegration,
  type MetaCredentials,
} from "@/lib/integrations/credentials";
import { connectionTestError } from "@/lib/integrations/errors";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import { listAdAccounts } from "@/lib/integrations/meta-ads";
import { createAdminClient } from "@/lib/supabase/admin";

// Test the stored Meta Ads connection by listing ad accounts.
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
  let integration;
  try {
    integration = await loadIntegration<MetaCredentials>(
      admin,
      access.clientId,
      "meta_ads"
    );
  } catch (err) {
    // Decrypt failures (ENCRYPTION_KEY mismatch) used to escape as a bare
    // 500, which the button showed as a network error.
    return NextResponse.json({ ok: false, error: connectionTestError(err) });
  }
  if (!integration) {
    return NextResponse.json({ ok: false, error: "Brak integracji Meta Ads" });
  }

  try {
    const accounts = await listAdAccounts(integration.credentials.access_token);
    return NextResponse.json({
      ok: true,
      accounts_count: accounts.length,
      sample: accounts.slice(0, 5).map((a) => a.name),
    });
  } catch (err) {
    // Only a dead token is "token wygasł"; anything else (rate limit,
    // missing env, network) shows its real message.
    return NextResponse.json({ ok: false, error: connectionTestError(err) });
  }
}
