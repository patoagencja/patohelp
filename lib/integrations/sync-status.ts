// Keep this file import-free: its unit tests run it directly under Node's
// type stripping, which can't resolve the "@/" alias.

export interface SyncOutcome {
  status: "success" | "failed";
  error_message: string | null;
}

/**
 * Decide how a provider sync run should be recorded.
 *
 * The ad crons used to write `status: "success"` unconditionally, keeping any
 * per-account errors only in error_message. So an integration whose accounts
 * ALL failed (expired token, revoked access) still looked perfectly healthy:
 * the dashboard's health check sees a fresh success and stays silent, which is
 * how Google Ads could stop delivering data without anything saying so.
 *
 * Rules:
 *  - nothing selected            -> failed (connected, but no account is being pulled)
 *  - no rows + EVERY account broke -> failed
 *  - rows written                -> success, keeping errors as a partial-failure note
 *  - no rows, some accounts fine -> success + note. Paused campaigns write no
 *    rows; one disabled account among 46 erroring must not turn "nothing is
 *    running" into "Meta is broken" (DRE's false banner).
 *  - no rows, no errors          -> success (legitimately no spend in the window)
 */
export function resolveSyncOutcome(opts: {
  accountsSelected: number;
  rowsWritten: number;
  accountErrors: string[];
}): SyncOutcome {
  const { accountsSelected, rowsWritten, accountErrors } = opts;
  // Five messages at most, but the count of the rest: a token-level Meta
  // limit can leave 40 of DRE's 46 accounts out, and five lines alone read
  // like five.
  const hidden = accountErrors.length - 5;
  const joined =
    accountErrors.slice(0, 5).join(" | ") + (hidden > 0 ? ` (+${hidden} więcej)` : "");

  if (accountsSelected === 0) {
    return {
      status: "failed",
      error_message:
        "Brak wybranych kont - wybierz konta reklamowe w Ustawieniach.",
    };
  }

  if (rowsWritten === 0 && accountErrors.length > 0 && accountErrors.length >= accountsSelected) {
    return { status: "failed", error_message: joined };
  }

  return {
    status: "success",
    error_message: accountErrors.length ? joined : null,
  };
}
