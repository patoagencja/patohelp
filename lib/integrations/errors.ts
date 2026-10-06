// Extract a human-readable message from an unknown thrown value. Handles
// plain Errors and the structured failure objects thrown by google-ads-api
// (which are not Error instances, so String(err) yields "[object Object]").
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;

  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (Array.isArray(anyErr.errors)) {
      return (anyErr.errors as Array<Record<string, unknown>>)
        .map((e) => (e?.message as string) ?? JSON.stringify(e))
        .join("; ");
    }
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    } catch {
      /* fall through */
    }
  }

  return String(err);
}

/**
 * True when a provider error means the stored OAuth token itself is dead
 * (expired / revoked) - fixed by reconnecting, not by retrying. Anything else
 * (rate limits, missing env, decrypt failures, network) must NOT be reported
 * as "token wygasł", or every provider looks expired at once.
 */
export function isTokenError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("invalid_grant") ||
    m.includes("invalid grant") ||
    m.includes("token has been expired") ||
    m.includes("revoked") ||
    // Meta: "Error validating access token: Session has expired on ..."
    m.includes("session has expired") ||
    m.includes("error validating access token")
  );
}

/** Agency-facing result text for a failed "Sprawdź połączenie" test. */
export function connectionTestError(err: unknown): string {
  const message = describeError(err);
  return isTokenError(message)
    ? "Token wygasł lub został odwołany - połącz ponownie"
    : `Test nie powiódł się: ${message}`;
}
