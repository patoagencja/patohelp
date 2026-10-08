import { timingSafeEqual } from "node:crypto";

/**
 * "Authorization: Bearer <CRON_SECRET>" on the cron routes, compared in
 * constant time (a plain !== leaks how many leading characters matched).
 * False when the secret isn't configured.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
