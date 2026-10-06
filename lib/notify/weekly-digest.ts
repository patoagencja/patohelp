import { getISOWeek, getISOWeekYear } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDashboardData } from "@/lib/dashboard/metrics";
import {
  getAgencyWorkEntries,
  type AgencyWorkCategory,
} from "@/lib/dashboard/overview";
import { getRecords, type RecordIcon, type RecordItem } from "@/lib/dashboard/records";
import { buildStory, type Story, type StoryFact, type Tone } from "@/lib/dashboard/story";
import { formatPlnWhole } from "@/lib/utils";

// "Twój tydzień w skrócie": the Monday e-mail for non-technical marketing
// managers. Deterministic on purpose (no LLM cost): the words come from the
// same buildStory()/getRecords() the dashboard uses, so the e-mail never says
// something the panel would contradict.
//
// Split in two halves:
// - loadWeeklyDigest(): reads Supabase only (never the ad/GA4 APIs);
// - buildWeeklyDigestEmail(): pure string builder, testable without a DB.

// ---- dates (plain yyyy-MM-dd strings in UTC maths, so no TZ drift) ----

const DAY_MS = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY_MS));

export interface DigestWeek {
  start: string; // Monday
  end: string; // Sunday
  prevStart: string;
  prevEnd: string;
  /** Dedupe key for notifications_sent, e.g. "weekly-digest-2026-W40". */
  key: string;
}

/**
 * The last COMPLETE Mon-Sun week before `today` (Warsaw yyyy-MM-dd). On a
 * Monday that's the week ending yesterday; on a Sunday the running week isn't
 * finished yet, so it's the one before.
 */
export function previousFullWeek(today: string): DigestWeek {
  const dow = toDate(today).getUTCDay(); // 0 = Sunday
  const end = addDays(today, -(((dow + 6) % 7) + 1));
  const start = addDays(end, -6);
  // Noon avoids the server's local TZ shifting the date for date-fns.
  const anchor = new Date(`${start}T12:00:00`);
  const week = String(getISOWeek(anchor)).padStart(2, "0");
  return {
    start,
    end,
    prevStart: addDays(start, -7),
    prevEnd: addDays(start, -1),
    key: `weekly-digest-${getISOWeekYear(anchor)}-W${week}`,
  };
}

const MONTHS_GEN = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

/** "5–11 października 2026" / "28 września – 4 października 2026". */
export function weekRangePl(start: string, end: string, withYear = true): string {
  const s = toDate(start);
  const e = toDate(end);
  const sy = s.getUTCFullYear();
  const ey = e.getUTCFullYear();
  const yearEnd = withYear ? ` ${ey}` : "";
  if (sy !== ey) {
    return `${s.getUTCDate()} ${MONTHS_GEN[s.getUTCMonth()]} ${sy} – ${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}${yearEnd}`;
  }
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}${yearEnd}`;
  }
  return `${s.getUTCDate()} ${MONTHS_GEN[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_GEN[e.getUTCMonth()]}${yearEnd}`;
}

/** "28.09–4.10" for the subject line, where space is tight. */
function weekRangeShort(start: string, end: string): string {
  const f = (s: string) => {
    const d = toDate(s);
    return `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return `${f(start)}–${f(end)}`;
}

// ---- content ----

export interface WeeklyDigestContent {
  clientName: string;
  week: DigestWeek;
  story: Story;
  /** Records reached during (or since) the reported week only. */
  records: RecordItem[];
  /** The client's own ad spend - never agency fees or other costs. */
  spendMinorUnits: number;
  prevSpendMinorUnits: number;
  dashboardUrl: string;
  /** "Co zrobiliśmy w tym tygodniu": manual, client-visible entries (max 5). */
  agencyWork?: { date: string; title: string; category: AgencyWorkCategory }[];
}

// buildStory() compares against "the previous period"; in a weekly e-mail the
// reader should know exactly what that is, so name it.
const weekly = (s: string) =>
  s
    .replace(/niż w poprzednim okresie/g, "niż tydzień wcześniej")
    .replace(/niż wcześniej/g, "niż tydzień wcześniej")
    .replace(/jak wcześniej/g, "jak tydzień wcześniej");

/**
 * Everything the digest needs for one client, read from Supabase with the
 * service-role client (the cron has no user session). Returns null when the
 * week has no data at all - an empty e-mail would only look like a bug.
 */
export async function loadWeeklyDigest(
  admin: SupabaseClient,
  client: { id: string; name: string; slug: string; ecommerce: boolean },
  today: string,
  appUrl: string
): Promise<WeeklyDigestContent | null> {
  const week = previousFullWeek(today);
  const data = await getDashboardData(
    client.id,
    "7d",
    { start: week.start, end: week.end },
    admin
  );

  const { kpis } = data;
  if (
    kpis.clicks.value === 0 &&
    kpis.sessions.value === 0 &&
    kpis.spendMinorUnits.value === 0
  ) {
    return null;
  }

  // Engagement clients never get revenue/ROAS: neither the story nor the
  // records are given e-commerce data unless the client is a shop.
  const story = buildStory({
    kpis,
    trend: data.trend,
    ecommerce: client.ecommerce ? data.ecommerce : null,
  });

  // getRecords() runs with the real "today" so a just-finished week is
  // described as finished ("Tydzień 28 września – 4 października przyniósł"),
  // not as running. Keep only what happened in or after the reported week -
  // a two-week-old milestone is not news on Monday.
  const records = (await getRecords(client.id, { ecommerce: client.ecommerce, today }))
    .filter((r) => r.achievedOn !== null && r.achievedOn >= week.start)
    .slice(0, 3);

  // Only what someone logged by hand and marked visible: automatic campaign
  // detections are heuristics, and a wrong one in an e-mail can't be undone.
  // A failed read just drops the section - the digest matters more.
  const agencyWork = (
    await getAgencyWorkEntries(client.id, week.start, week.end, admin).catch(() => [])
  )
    .filter((e) => e.visibleToClient)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map(({ date, title, category }) => ({ date, title, category }));

  return {
    clientName: client.name,
    week,
    story: {
      ...story,
      facts: story.facts.map((f) =>
        f.change ? { ...f, change: { ...f.change, text: weekly(f.change.text) } } : f
      ),
      watch: story.watch ? weekly(story.watch) : null,
    },
    records,
    spendMinorUnits: kpis.spendMinorUnits.value,
    prevSpendMinorUnits: kpis.spendMinorUnits.previous,
    // Open the panel on the very week the e-mail describes (same custom range,
    // same previous-week baseline). The default "last 30 days" view showed
    // different totals, so the e-mail looked wrong next to the panel.
    dashboardUrl: `${appUrl.replace(/\/+$/, "")}/${client.slug}?from=${week.start}&to=${week.end}`,
    agencyWork,
  };
}

// ---- pure HTML builder ----
// Table-based layout with inline styles: e-mail clients (Gmail, Outlook)
// strip most <style> rules, so styling must live on the elements. Palette
// matches the alert e-mail in lib/notify/send.ts (slate + indigo).

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const TONE: Record<Tone, { fg: string }> = {
  good: { fg: "#15803d" },
  bad: { fg: "#b91c1c" },
  flat: { fg: "#475569" },
};

const RECORD_ICON: Record<RecordIcon, string> = {
  trophy: "🏆",
  flag: "🚩",
  sparkles: "✨",
  trending: "📈",
};

/** Accent stripe per number so the four tiles read as distinct at a glance. */
const FACT_ACCENT: Record<string, string> = {
  impressions: "#818cf8",
  clicks: "#4f46e5",
  sessions: "#0ea5e9",
  cpc: "#10b981",
  revenue: "#10b981",
  orders: "#4f46e5",
  roas: "#f59e0b",
};

function arrowFor(text: string): string {
  if (/więcej|drożej/.test(text)) return "▲";
  if (/mniej|taniej/.test(text)) return "▼";
  return "●";
}

/** "▲ o 16% więcej" in the tone colour + "niż tydzień wcześniej" muted, so
 *  the eye catches the direction first and the words still read naturally. */
function changeLine(change: NonNullable<StoryFact["change"]>): string {
  const { fg } = TONE[change.tone];
  const cut = change.text.indexOf(" niż ");
  const head = cut > 0 ? change.text.slice(0, cut) : change.text;
  const tail = cut > 0 ? change.text.slice(cut) : "";
  return `<div style="margin-top:10px;font-size:13px;line-height:1.45;color:#64748b"><span style="color:${fg};font-weight:700;white-space:nowrap">${arrowFor(change.text)}&nbsp;${esc(head)}</span>${esc(tail)}</div>`;
}

// Each tile is the <td> itself (not a nested table) so tiles in one row share
// the row height - no ragged bottoms when only one of them has a comparison.
function factTile(f: StoryFact): string {
  const accent = FACT_ACCENT[f.key] ?? "#4f46e5";
  return `
    <td class="tile" width="50%" valign="top" style="background:#f8fafc;border:1px solid #e2e8f0;border-top:4px solid ${accent};border-radius:14px;padding:16px 16px 18px">
      <div class="fact-value" style="font-size:30px;line-height:1.1;font-weight:800;color:#0f172a;letter-spacing:-0.5px;white-space:nowrap">${esc(f.value)}</div>
      <div style="margin-top:6px;font-size:14px;line-height:1.4;color:#334155">${esc(f.caption)}</div>
      ${f.change ? changeLine(f.change) : ""}
    </td>`;
}

function factsGrid(facts: StoryFact[]): string {
  const rows: string[] = [];
  for (let i = 0; i < facts.length; i += 2) {
    const pair = facts.slice(i, i + 2);
    const cells = pair.map(factTile).join("");
    // Odd count: an empty cell keeps the last tile at half width.
    const filler = pair.length === 1 ? `<td width="50%">&nbsp;</td>` : "";
    rows.push(`<tr>${cells}${filler}</tr>`);
  }
  // border-spacing gives the gutters; Outlook ignores it and just butts the
  // tiles together, which still reads fine.
  return `<table class="grid" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:10px">${rows.join("")}</table>`;
}

function sectionTitle(text: string): string {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin:0 0 12px">${esc(text)}</div>`;
}

function winsList(wins: string[]): string {
  const rows = wins
    .map(
      (w) => `
      <tr>
        <td width="34" valign="top" style="padding:8px 0">
          <div style="width:24px;height:24px;border-radius:999px;background:#dcfce7;color:#15803d;text-align:center;line-height:24px;font-size:13px;font-weight:800">✓</div>
        </td>
        <td valign="top" style="padding:9px 0 8px;font-size:15px;line-height:1.5;color:#334155">${esc(w)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

function recordsList(records: RecordItem[]): string {
  return records
    .map(
      (r, i) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#fffbeb;border:1px solid #fde68a;border-radius:14px;margin-top:${i === 0 ? 0 : 10}px">
        <tr>
          <td width="56" valign="top" style="padding:16px 0 16px 16px">
            <div style="width:40px;height:40px;border-radius:12px;background:#fef3c7;text-align:center;line-height:40px;font-size:20px">${RECORD_ICON[r.icon] ?? "🏆"}</div>
          </td>
          <td valign="top" style="padding:16px 16px 16px 12px">
            <div style="font-size:15px;line-height:1.4;font-weight:700;color:#0f172a">${esc(r.title)}</div>
            <div style="margin-top:4px;font-size:13px;line-height:1.5;color:#57534e">${esc(r.detail)}</div>
          </td>
        </tr>
      </table>`
    )
    .join("");
}

const WORK_ICON: Record<AgencyWorkCategory, string> = {
  kampania: "📣",
  kreacja: "🎨",
  optymalizacja: "🛠️",
  raport: "📄",
  strona: "🌐",
  inne: "✨",
};

const DOW_SHORT = ["nd", "pon", "wt", "śr", "czw", "pt", "sob"];

function workList(items: NonNullable<WeeklyDigestContent["agencyWork"]>): string {
  const rows = items
    .map((w) => {
      const d = toDate(w.date);
      const day = `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      return `
      <tr>
        <td width="34" valign="top" style="padding:8px 0">
          <div style="width:24px;height:24px;border-radius:8px;background:#eef2ff;text-align:center;line-height:24px;font-size:13px">${WORK_ICON[w.category] ?? "✨"}</div>
        </td>
        <td valign="top" style="padding:9px 0 8px;font-size:15px;line-height:1.5;color:#334155">${esc(w.title)}</td>
        <td valign="top" align="right" style="padding:10px 0 8px 12px;font-size:12px;line-height:1.5;color:#94a3b8;white-space:nowrap">${esc(day)}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

function spendRow(current: number, previous: number): string {
  const prev =
    previous > 0
      ? `<div style="margin-top:2px;font-size:12px;color:#94a3b8">tydzień wcześniej: ${esc(formatPlnWhole(previous))}</div>`
      : "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #f1f5f9">
      <tr>
        <td valign="middle" style="padding:16px 0 0;font-size:14px;line-height:1.4;color:#475569">
          Budżet reklamowy wydany w tym tygodniu
          ${prev}
        </td>
        <td valign="middle" align="right" style="padding:16px 0 0;font-size:18px;font-weight:800;color:#0f172a;white-space:nowrap">${esc(formatPlnWhole(current))}</td>
      </tr>
    </table>`;
}

export interface WeeklyDigestEmail {
  subject: string;
  /** Hidden inbox preview line. */
  preheader: string;
  html: string;
}

export function buildWeeklyDigestEmail(c: WeeklyDigestContent): WeeklyDigestEmail {
  const range = weekRangePl(c.week.start, c.week.end);
  const prevRange = weekRangePl(c.week.prevStart, c.week.prevEnd, false);
  const subject = `Twój tydzień w skrócie · ${c.clientName} (${weekRangeShort(
    c.week.start,
    c.week.end
  )})`;
  const preheader = c.story.headline;

  const section = (inner: string, top = 28) =>
    `<tr><td class="px" style="padding:${top}px 32px 0">${inner}</td></tr>`;

  const winsHtml = c.story.wins.length
    ? section(`${sectionTitle("Dobre wiadomości")}${winsList(c.story.wins)}`)
    : "";
  const workHtml = c.agencyWork?.length
    ? section(`${sectionTitle("Co zrobiliśmy w tym tygodniu")}${workList(c.agencyWork)}`)
    : "";
  const recordsHtml = c.records.length
    ? section(`${sectionTitle("Rekordy i kamienie milowe")}${recordsList(c.records)}`)
    : "";
  const watchHtml = c.story.watch
    ? section(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #f59e0b;border-radius:10px">
        <tr><td style="padding:14px 16px">
          <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b45309">Pod lupą</div>
          <div style="margin-top:4px;font-size:14px;line-height:1.5;color:#334155">${esc(c.story.watch)}</div>
        </td></tr>
      </table>`)
    : "";

  const url = esc(c.dashboardUrl);
  // Preheader padding stops clients from pulling body text into the preview.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(60);

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  @media only screen and (max-width:480px) {
    .px { padding-left:20px !important; padding-right:20px !important; }
    .hero { padding:28px 20px 26px !important; }
    .headline { font-size:20px !important; }
    .gridwrap { padding-left:12px !important; padding-right:12px !important; }
    .grid { border-spacing:8px !important; }
    .tile { padding:14px 12px 16px !important; }
    .fact-value { font-size:24px !important; }
    .outer { padding:12px 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f1f5f9">
  <tr>
    <td class="outer" align="center" style="padding:32px 12px;font-family:${FONT}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden">
        <tr>
          <td class="hero" style="background:#4f46e5;background-image:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:34px 32px 30px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#e0e7ff">Twój tydzień w skrócie</div>
            <div style="margin-top:8px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.4px;color:#ffffff">${esc(c.clientName)}</div>
            <div style="margin-top:6px;font-size:14px;color:#e0e7ff">${esc(range)}</div>
          </td>
        </tr>
        ${section(
          `<div class="headline" style="font-size:22px;line-height:1.4;font-weight:700;color:#0f172a;letter-spacing:-0.2px">${esc(c.story.headline)}</div>`,
          30
        )}
        <tr><td class="gridwrap" style="padding:18px 22px 0">${factsGrid(c.story.facts)}</td></tr>
        ${section(spendRow(c.spendMinorUnits, c.prevSpendMinorUnits), 14)}
        ${winsHtml}
        ${workHtml}
        ${recordsHtml}
        ${watchHtml}
        <tr>
          <td class="px" align="center" style="padding:34px 32px 8px">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate">
              <tr>
                <td align="center" style="border-radius:12px;background:#4f46e5">
                  <a href="${url}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">Zobacz pełny panel&nbsp;&rarr;</a>
                </td>
              </tr>
            </table>
            <div style="margin-top:10px;font-size:12px;color:#94a3b8">Wykresy, kampanie i ruch na stronie - wszystko w jednym miejscu.</div>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:28px 32px 26px">
            <div style="border-top:1px solid #f1f5f9;padding-top:18px;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center">
              Porównanie z tygodniem ${esc(prevRange)}. Dane z kont reklamowych i Google Analytics 4.<br>
              Wysyłane automatycznie w każdy poniedziałek przez panel · patoagencja<br>
              Nie chcesz dostawać tego podsumowania? Daj znać swojemu opiekunowi w agencji.
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, preheader, html };
}
