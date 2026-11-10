// Import-free: the unit tests run it directly under Node's type stripping.

/**
 * The part of an ad set name that tells it apart. OLX-style names repeat the
 * whole campaign name first ("OLX-PL | BRAND | ... | PATO | STATICS | B -
 * Auto / Motoryzacja | EPA"), so a truncated tile showed the same "OLX-PL |
 * BRAND | SERVICES | LIST ..." on every tile. Drop the leading segments it
 * shares with its campaign; the full name stays in the tooltip.
 */
export function distinctAdsetName(adset: string, campaign: string): string {
  // Segments with where each ends in the original string, so what is shown
  // is the name's own text ("Auto / Motoryzacja" keeps its slash).
  const segments = (name: string) => {
    const out: Array<{ text: string; end: number }> = [];
    const re = /[^|/]+/g;
    for (let m = re.exec(name); m; m = re.exec(name)) {
      const text = m[0].trim();
      if (text) out.push({ text: text.toLowerCase(), end: m.index + m[0].length });
    }
    return out;
  };
  const a = segments(adset);
  const c = segments(campaign);
  let shared = 0;
  while (shared < a.length && shared < c.length && a[shared].text === c[shared].text) shared += 1;
  // Two shared segments at least (a real naming scheme, not a coincidence)
  // and something left to show.
  if (shared < 2 || shared >= a.length) return adset;
  const rest = adset.slice(a[shared - 1].end).replace(/^[\s|/]+/, "").trim();
  return rest || adset;
}

/**
 * "został 1 dzień", "zostały 2 dni", "zostało 5 dni" - the verb agrees with
 * the number ("zostało 1 dzień" read on every goal's last day).
 */
export function daysLeftText(days: number): string {
  const n = Math.abs(Math.round(days));
  const last = n % 10;
  const lastTwo = n % 100;
  if (n === 1) return `został ${days} dzień`;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `zostały ${days} dni`;
  return `zostało ${days} dni`;
}
