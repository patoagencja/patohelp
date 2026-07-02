import { NextResponse } from "next/server";

// OAuth connect flow for the ga4 integration.
// Stores per-client tokens (encrypted) in the `integrations` table.
// Implementation lands in Phase 2.
export async function GET() {
  return NextResponse.json(
    { error: "Not implemented — Phase 2" },
    { status: 501 }
  );
}
