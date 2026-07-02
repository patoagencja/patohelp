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
