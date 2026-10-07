// Seasonal clients: businesses that earn in one window a year (e.g. Christmas
// products, October to Christmas Eve). The window is set per client by the
// agency (clients.season, migration 0037) as month-day pairs; everything
// here is pure date maths on Warsaw calendar days (yyyy-MM-dd strings).

export interface SeasonConfig {
  /** First day of the season, "MM-DD". */
  start: string;
  /** Last day of the season, "MM-DD"; before `start` = runs into next year. */
  end: string;
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Days per month in a non-leap year: 29 February would vanish 3 years in 4. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const realDay = (mmdd: string) => {
  const [m, d] = mmdd.split("-").map(Number);
  return d <= MONTH_DAYS[m - 1];
};

export function parseSeason(raw: unknown): SeasonConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const { start, end } = raw as { start?: unknown; end?: unknown };
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!MMDD.test(start) || !MMDD.test(end) || start === end) return null;
  // The DB check only tests the shape; "02-30" would make every date query
  // on the Sezon page fail.
  if (!realDay(start) || !realDay(end)) return null;
  return { start, end };
}

export interface SeasonWindow {
  start: string;
  end: string;
  /** The year the season starts in - its name ("Sezon 2026"). */
  year: number;
}

export function seasonWindow(cfg: SeasonConfig, year: number): SeasonWindow {
  const wraps = cfg.end < cfg.start;
  return {
    start: `${year}-${cfg.start}`,
    end: `${wraps ? year + 1 : year}-${cfg.end}`,
    year,
  };
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDaysIso(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  );
}

export function seasonLength(w: SeasonWindow): number {
  return diffDaysIso(w.start, w.end) + 1;
}

/**
 * Where the client stands today:
 * - "in": the season runs; `current` is it, `previous` the one before.
 * - "pre": before this year's start; `current` is the last finished season.
 * - "post": this year's season is over; `current` is that finished season.
 * `next` is the upcoming season outside "in".
 */
export interface SeasonState {
  phase: "in" | "pre" | "post";
  current: SeasonWindow;
  previous: SeasonWindow;
  next: SeasonWindow | null;
  /** 1-based day of the running season ("in" only). */
  day: number | null;
  totalDays: number;
  /** Days until `next` starts (outside "in"). */
  daysToNext: number | null;
}

export function seasonState(cfg: SeasonConfig, today: string): SeasonState {
  const year = Number(today.slice(0, 4));
  const thisYear = seasonWindow(cfg, year);
  const lastYear = seasonWindow(cfg, year - 1);
  const inWindow = (w: SeasonWindow) => today >= w.start && today <= w.end;

  // A season running into January started last year.
  const running = inWindow(thisYear) ? thisYear : inWindow(lastYear) ? lastYear : null;
  if (running) {
    return {
      phase: "in",
      current: running,
      previous: seasonWindow(cfg, running.year - 1),
      next: null,
      day: diffDaysIso(running.start, today) + 1,
      totalDays: seasonLength(running),
      daysToNext: null,
    };
  }
  if (today < thisYear.start) {
    return {
      phase: "pre",
      current: lastYear,
      previous: seasonWindow(cfg, year - 2),
      next: thisYear,
      day: null,
      totalDays: seasonLength(lastYear),
      daysToNext: diffDaysIso(today, thisYear.start),
    };
  }
  const next = seasonWindow(cfg, year + 1);
  return {
    phase: "post",
    current: thisYear,
    previous: lastYear,
    next,
    day: null,
    totalDays: seasonLength(thisYear),
    daysToNext: diffDaysIso(today, next.start),
  };
}

function blackFriday(year: number): string {
  // The day after the fourth Thursday of November.
  const dow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - dow + 7) % 7);
  return `${year}-11-${String(firstThursday + 22).padStart(2, "0")}`;
}

export interface SeasonMoment {
  key: string;
  label: string;
  /** Short form for chart ticks. */
  short: string;
  date: string;
}

/**
 * The sales moments that fall inside a season window: shopping days and the
 * gift-giving dates seasonal gift products live on (Mikołajki / Nikolaustag on
 * 6 Dec, Christmas Eve, Befana in Italy on 6 Jan). Outside the window they
 * don't apply, so a spring season simply gets none.
 */
export function seasonMoments(w: SeasonWindow): SeasonMoment[] {
  // Both calendar years the window may touch: a season starting in January
  // still needs that January's Befana, one starting late still gets
  // Christmas of its own year.
  const all: SeasonMoment[] = [];
  for (const y of [w.year - 1, w.year]) {
    const bf = blackFriday(y);
    all.push(
      { key: `bf-${y}`, label: "Black Friday", short: "BF", date: bf },
      { key: `cm-${y}`, label: "Cyber Monday", short: "CM", date: addDaysIso(bf, 3) },
      { key: `mikolajki-${y}`, label: "Mikołajki", short: "6.12", date: `${y}-12-06` },
      { key: `wigilia-${y}`, label: "Wigilia", short: "24.12", date: `${y}-12-24` },
      { key: `befana-${y + 1}`, label: "Befana (Włochy)", short: "6.01", date: `${y + 1}-01-06` }
    );
  }
  return all.filter((m) => m.date >= w.start && m.date <= w.end);
}

/** "1 października" - the Polish genitive month for "do 24 grudnia". */
export const MONTH_GEN = [
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
];

export function dayMonthLong(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_GEN[m - 1]}`;
}

/** "dzień" / "dni" for a count. */
export function daysWord(n: number): string {
  return n === 1 ? "dzień" : "dni";
}
