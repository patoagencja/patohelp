// Which login-customer-id a Google Ads query may authenticate as.
// Import-free (unit tests run it directly).

const digitsOnly = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * Client account id -> the manager (MCC) it was listed under, from stored
 * account rows ({ id, login_customer_id }). Ids are compared digits-only
 * ("123-456-7890" and "1234567890" are the same account).
 */
export function managerLoginsOf(accounts: unknown): Array<[string, string]> {
  if (!Array.isArray(accounts)) return [];
  const pairs: Array<[string, string]> = [];
  for (const a of accounts as Array<{ id?: unknown; login_customer_id?: unknown } | null>) {
    const id = digitsOnly(a?.id);
    const login = digitsOnly(a?.login_customer_id);
    if (id && login && id !== login) pairs.push([id, login]);
  }
  return pairs;
}

/**
 * The account itself first (direct access), then the manager it was listed
 * under, then the agency's configured MCC - no duplicates.
 */
export function candidateLoginIds(
  customerId: string,
  manager: string | undefined,
  envMcc: string | undefined
): string[] {
  const list = [customerId];
  for (const id of [manager, envMcc]) {
    if (id && !list.includes(id)) list.push(id);
  }
  return list;
}
