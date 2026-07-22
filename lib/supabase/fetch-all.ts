// PostgREST silently caps a single select at ~1000 rows. Any query that can
// exceed that (ads_daily over long ranges for large accounts) must paginate,
// or the tail of the result vanishes without an error.

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Drains a range-paginated query. `build` must apply a STABLE order (e.g.
 * .order("date").order("campaign_id")) and then .range(from, to).
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
