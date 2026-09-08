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
 *  - nothing selected      -> failed (connected, but no account is being pulled)
 *  - no rows + errors      -> failed (every account broke)
 *  - rows written          -> success, keeping errors as a partial-failure note
 *  - no rows, no errors    -> success (legitimately no spend in the window)
 */
export function resolveSyncOutcome(opts: {
  accountsSelected: number;
  rowsWritten: number;
  accountErrors: string[];
}): SyncOutcome {
  const { accountsSelected, rowsWritten, accountErrors } = opts;
  const joined = accountErrors.slice(0, 5).join(" | ");

  if (accountsSelected === 0) {
    return {
      status: "failed",
      error_message:
        "Brak wybranych kont - wybierz konta reklamowe w Ustawieniach.",
    };
  }

  if (rowsWritten === 0 && accountErrors.length > 0) {
    return { status: "failed", error_message: joined };
  }

  return {
    status: "success",
    error_message: accountErrors.length ? joined : null,
  };
}
