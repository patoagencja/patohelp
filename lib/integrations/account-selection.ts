// Dependency-free on purpose: the unit tests run these files directly with
// Node's built-in type stripping, which can't resolve the "@/" alias or any
// server-only import.

/** Account ids across formats: "act_123" (Meta), "123-456-7890" (Google). */
const accountKey =(id: unknown) => String(id).replace(/^act_/, "").replace(/-/g, "");

/**
 * The new account list with the previous per-account choices carried over.
 * A previously SELECTED account the new login doesn't list (a System User
 * token without that account assigned, a reconnect with another Facebook
 * profile) used to vanish with its selection - DRE went to "0 of 46
 * selected" and every sync failed. It now stays, still selected and marked
 * `unlisted`: the sync then names the account it can't read instead of
 * silently pulling nothing, and the choice survives the next reconnect.
 */
export function mergeAccountSelection(
  previous: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byId = new Map(previous.map((a) => [accountKey(a.id), a]));
  const listed = new Set(next.map((a) => accountKey(a.id)));
  const carried = next.map((a) => {
    const prev = byId.get(accountKey(a.id));
    if (!prev) return a;
    return {
      ...a,
      ...(prev.selected !== undefined ? { selected: prev.selected } : {}),
      ...(prev.video_only !== undefined ? { video_only: prev.video_only } : {}),
      ...(prev.was_selected !== undefined ? { was_selected: prev.was_selected } : {}),
    };
  });
  const kept = previous
    .filter((a) => a.selected === true && !listed.has(accountKey(a.id)))
    .map((a) => ({ ...a, unlisted: true }));
  return [...carried, ...kept];
}
