// Several GA4 properties per client (Elfi: one per country site) summed into
// the one set of numbers the dashboard reads. Import-free so the unit tests
// run it directly under Node's type stripping.

/**
 * The client's GA4 properties. `propertyIds` (the multi-select) wins only
 * while it still contains `propertyId`: flows that set a single property
 * (service account, older code) only write `propertyId`, and a stale list
 * must not override that choice.
 */
export function selectedGa4Properties(accountIds: unknown): string[] {
  const a = (accountIds ?? {}) as { propertyId?: unknown; propertyIds?: unknown };
  const single = typeof a.propertyId === "string" && a.propertyId ? a.propertyId : null;
  const list = Array.isArray(a.propertyIds)
    ? Array.from(new Set(a.propertyIds.filter((p): p is string => typeof p === "string" && p !== "")))
    : [];
  if (list.length && (!single || list.includes(single))) return list;
  return single ? [single] : [];
}

/**
 * Rows of several properties folded by `key`: `sums` are added up, `rates`
 * (e.g. engagementRate) become the average weighted by `weight` (sessions),
 * every other field keeps the first row's value.
 */
export function mergeRows<T extends Record<string, unknown>>(
  rows: T[],
  key: (row: T) => string,
  opts: { sums: Array<keyof T>; rates?: Array<keyof T>; weight?: keyof T }
): T[] {
  const out = new Map<string, { row: T; weights: Map<keyof T, number> }>();
  const weightOf = (r: T) => (opts.weight ? Number(r[opts.weight] ?? 0) : 1);
  for (const r of rows) {
    const k = key(r);
    const cur = out.get(k);
    if (!cur) {
      const weights = new Map<keyof T, number>();
      const row = { ...r };
      for (const f of opts.rates ?? []) {
        weights.set(f, weightOf(r));
        (row as Record<keyof T, unknown>)[f] = Number(r[f] ?? 0) * weightOf(r);
      }
      out.set(k, { row, weights });
      continue;
    }
    for (const f of opts.sums) {
      (cur.row as Record<keyof T, unknown>)[f] = Number(cur.row[f] ?? 0) + Number(r[f] ?? 0);
    }
    for (const f of opts.rates ?? []) {
      cur.weights.set(f, (cur.weights.get(f) ?? 0) + weightOf(r));
      (cur.row as Record<keyof T, unknown>)[f] = Number(cur.row[f] ?? 0) + Number(r[f] ?? 0) * weightOf(r);
    }
  }
  return Array.from(out.values()).map(({ row, weights }) => {
    for (const f of opts.rates ?? []) {
      const w = weights.get(f) ?? 0;
      // No weight at all (no sessions anywhere): a plain 0, not NaN.
      (row as Record<keyof T, unknown>)[f] = w > 0 ? Number(row[f] ?? 0) / w : 0;
    }
    return row;
  });
}
