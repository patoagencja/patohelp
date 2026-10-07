// NBP (Narodowy Bank Polski) table A mid rates: PLN per 1 unit of a foreign
// currency. Ad platforms report money in the AD ACCOUNT's currency, while
// every table here stores PLN grosze - a ".com" account billed in USD would
// otherwise read ~4x too cheap next to the Polish ones.
//
// Import-free on purpose: the unit tests run this file directly under Node's
// type stripping, which can't resolve the "@/" alias.

const NBP_BASE = "https://api.nbp.pl/api/exchangerates/rates/a";
const DAY_MS = 86_400_000;

/**
 * Days per cached NBP request. NBP rejects ranges longer than 93 days; a
 * block plus its look-back (90 days) stays under that, and fixed blocks mean
 * a 470-day backfill costs ~6 requests per currency, each made once per run.
 */
export const BLOCK_DAYS = 80;
/**
 * Days fetched before each block, so a block's first days can still resolve
 * to the business day before them. The longest Polish run of days without a
 * table (Christmas Eve to the weekend after Boxing Day, Easter) is ~5 days.
 */
export const LOOKBACK_DAYS = 10;
/** A rate older than this for the day converted means "unknown", not "use it". */
export const MAX_RATE_AGE_DAYS = 10;
const FETCH_TIMEOUT_MS = 15_000;

export interface FxResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FxFetch = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<FxResponse>;

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "usd " -> "USD"; anything that isn't a 3-letter code -> null. */
export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * The NBP table day whose rate applies to `day`: the day itself when NBP
 * published a table on it, else the last business day before it (weekends,
 * holidays, and today before the ~12:00 publication). `rateDays` must be
 * sorted ascending. null when nothing is at most `maxAgeDays` old.
 */
export function resolveRateDay(
  day: string,
  rateDays: readonly string[],
  maxAgeDays: number = MAX_RATE_AGE_DAYS
): string | null {
  // Greatest rate day <= day (binary search: a 470-day backfill asks often).
  let lo = 0;
  let hi = rateDays.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rateDays[mid] <= day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const hit = rateDays[found];
  return dayNumber(day) - dayNumber(hit) <= maxAgeDays ? hit : null;
}

/**
 * The NBP request that covers `day`: its fixed block plus the look-back,
 * ending no later than `today` (NBP has nothing for future days). `key`
 * identifies the block for caching.
 */
export function nbpRangeFor(day: string, today: string): { key: number; start: string; end: string } {
  const key = Math.floor(dayNumber(day) / BLOCK_DAYS);
  const start = isoOf(key * BLOCK_DAYS - LOOKBACK_DAYS);
  const blockEnd = isoOf(key * BLOCK_DAYS + BLOCK_DAYS - 1);
  return { key, start, end: blockEnd < today ? blockEnd : today };
}

/** Today's calendar date in Warsaw (NBP's calendar). */
function warsawToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface RateBlock {
  days: string[];
  mid: Map<string, number>;
}

export interface FxConverter {
  /**
   * PLN per 1 unit of `currency` for `day` (yyyy-MM-dd); 1 for PLN. null when
   * the code is unusable or NBP has no rate for it - callers must then skip
   * the write rather than store foreign money as złoty.
   */
  rate(currency: string | null | undefined, day: string): Promise<number | null>;
  /**
   * Mean daily rate over [from, to] (calendar days, each resolved like
   * `rate`), for amounts Meta/Google only report as one sum for a period.
   * null when any day has no rate.
   */
  averageRate(currency: string | null | undefined, from: string, to: string): Promise<number | null>;
}

/**
 * One converter per cron run: every NBP block is fetched at most once and
 * shared by all clients and accounts of the run. `fetch` and `today` are
 * injectable for tests.
 */
export function createFxConverter(opts: { fetch?: FxFetch; today?: string } = {}): FxConverter {
  const doFetch: FxFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const today = opts.today ?? warsawToday();
  const blocks = new Map<string, Promise<RateBlock | null>>();

  async function fetchBlock(code: string, start: string, end: string): Promise<RateBlock | null> {
    const url = `${NBP_BASE}/${code.toLowerCase()}/${start}/${end}/?format=json`;
    // Two attempts: one NBP blip must not cost a foreign account a whole run.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await doFetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        // 404 = "Brak danych": no table in the range (or a code table A
        // doesn't carry). Definitive, so no retry - the caller sees no rate.
        if (res.status === 404) return { days: [], mid: new Map() };
        if (!res.ok) continue;
        const body = (await res.json()) as { rates?: Array<{ effectiveDate?: unknown; mid?: unknown }> };
        const mid = new Map<string, number>();
        for (const r of body?.rates ?? []) {
          const d = typeof r.effectiveDate === "string" ? r.effectiveDate : "";
          const m = Number(r.mid);
          if (ISO_DAY.test(d) && Number.isFinite(m) && m > 0) mid.set(d, m);
        }
        return { days: [...mid.keys()].sort(), mid };
      } catch {
        // timeout / network: retry once, then give up for this run
      }
    }
    return null;
  }

  async function rate(currency: string | null | undefined, day: string): Promise<number | null> {
    const code = normalizeCurrency(currency);
    if (!ISO_DAY.test(day)) return null;
    // No currency at all (field missing from a response and none stored)
    // keeps the pre-FX behaviour - złoty - instead of halting the sync of
    // every existing client; an account in another currency reports it
    // (Meta account_currency, Google customer.currency_code). A currency
    // that IS given but unreadable still gets no rate.
    if (currency == null || String(currency).trim() === "") return 1;
    if (!code) return null;
    if (code === "PLN") return 1;
    // An account in a timezone ahead of Warsaw can report "tomorrow".
    const d = day > today ? today : day;
    const range = nbpRangeFor(d, today);
    const cacheKey = `${code}:${range.key}`;
    let block = blocks.get(cacheKey);
    if (!block) {
      block = fetchBlock(code, range.start, range.end);
      blocks.set(cacheKey, block);
    }
    const loaded = await block;
    if (!loaded) return null;
    const hit = resolveRateDay(d, loaded.days);
    return hit ? loaded.mid.get(hit) ?? null : null;
  }

  async function averageRate(
    currency: string | null | undefined,
    from: string,
    to: string
  ): Promise<number | null> {
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return null;
    if (normalizeCurrency(currency) === "PLN") return 1;
    let sum = 0;
    let n = 0;
    for (let k = dayNumber(from); k <= dayNumber(to); k += 1) {
      const r = await rate(currency, isoOf(k));
      if (r == null) return null;
      sum += r;
      n += 1;
    }
    return n ? sum / n : null;
  }

  return { rate, averageRate };
}

/** Major units in `rate`'s currency -> PLN grosze. */
export function toGrosze(major: number, rate: number): number {
  return Math.round(major * rate * 100);
}
