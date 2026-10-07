import { NextResponse } from "next/server";

import {
  findClientByIngestKey,
  markIngestKeyUsed,
  takeIngestSlot,
  toSaleRows,
  upsertShopSales,
  validateApiPayload,
} from "@/lib/shop/ingest";
import { dateRange } from "@/lib/shop/parse";
import { createAdminClient } from "@/lib/supabase/admin";

// The shop's sales push: its CMS calls this every hour with the last 14 days
// of paid orders (Authorization: Bearer kal_live_...). An API route, not a
// Server Action, because an external system calls it. middleware.ts skips
// every /api/ path, so no Supabase session is needed or checked here - the
// key is the only credential. Never log it.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// 5000 rows of JSON are ~0.5 MB; 2 MB leaves room for long product names
// without letting anyone stream an unbounded body into memory.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const tooLarge = () =>
  json({ ok: false, error: "Za duże żądanie - maks. 2 MB (ok. 5000 wierszy). Podziel dane na kilka żądań." }, 413);

/** Reads the body, giving up as soon as it passes `max` bytes (a missing or
 *  lying Content-Length must not get around the limit). */
async function readBodyCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  // One generic answer for a missing, malformed, revoked or unknown key: the
  // response must not help anyone probe which keys exist.
  const unauthorized = () =>
    json({ ok: false, error: "Brak dostępu - nieprawidłowy lub wyłączony klucz API." }, 401, {
      "WWW-Authenticate": "Bearer",
    });
  if (!match) return unauthorized();

  const admin = createAdminClient();
  const lookup = await findClientByIngestKey(admin, match[1]);
  if (lookup.status === "unavailable") {
    return json({ ok: false, error: "Usługa chwilowo niedostępna - spróbuj ponownie później." }, 503);
  }
  if (lookup.status === "unknown") return unauthorized();
  const clientId = lookup.clientId;
  if (!(await takeIngestSlot(admin, clientId))) {
    return json({ ok: false, error: "Za dużo żądań - maks. 120 na godzinę. Wysyłaj dane raz na godzinę." }, 429, {
      "Retry-After": "600",
    });
  }

  const text = await readBodyCapped(request, MAX_BODY_BYTES);
  if (text === null) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(
      { ok: false, error: "Nieprawidłowy JSON", issues: [{ path: "", message: "treść żądania musi być poprawnym JSON-em" }] },
      400
    );
  }

  const validated = validateApiPayload(body);
  if (!validated.ok) {
    return json({ ok: false, error: validated.error, issues: validated.issues }, 400);
  }

  const rows = toSaleRows(validated.rows);
  const saved = await upsertShopSales(admin, clientId, rows, "api");
  if (!saved.ok) {
    // The client id is enough to find the shop; the key never goes to logs.
    console.error(`[ingest/sales] upsert failed for client ${clientId}: ${saved.message}`);
    return json({ ok: false, error: "Nie udało się zapisać danych - spróbuj ponownie." }, saved.missingTable ? 503 : 500);
  }

  await markIngestKeyUsed(admin, clientId, saved.rows);

  return json({ ok: true, rows: saved.rows, dates: dateRange(rows) });
}

export function GET() {
  return json({ ok: false, error: "Użyj metody POST." }, 405, { Allow: "POST" });
}
