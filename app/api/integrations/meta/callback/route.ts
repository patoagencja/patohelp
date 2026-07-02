import { NextResponse } from "next/server";

// OAuth callback flow for the meta integration.
// Stores per-client tokens (encrypted) in the `integrations` table.
// Implementation lands in Phase 2.
export async function GET() {
  return NextResponse.json(
    { error: "Not implemented — Phase 2" },
    { status: 501 }
  );
}
