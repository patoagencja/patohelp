import { fromZonedTime } from "date-fns-tz";

import type { EcomAnalysis } from "@/lib/ecom/analysis";
import { computeProfit, dayLabelPl, type EcomSettings } from "@/lib/ecom/insights";
import type { AiSummary } from "@/lib/dashboard/overview";
import { plPlural } from "@/lib/dashboard/story";
import { DEMO_PRODUCTS } from "@/lib/demo/brand";
import { campaignName, type DemoLang } from "@/lib/demo/dashboard";
import { addDaysIso } from "@/lib/demo/profile/anonymize";
import { blackFridayOf, diffDaysIso, type DemoDay, type DemoSource } from "@/lib/demo/source";
import { marketLabel } from "@/lib/season/markets";
import { formatNumberPL, formatPlnWhole } from "@/lib/utils";

// The demo's written texts: the overview's AI summary and Sprzedaż's AI
// analysis. The real ones come from a model over the client's data; the
// demo has no model call, and its numbers aren't known when the code is
// written (they may be a real shop's anonymized weeks), so every sentence
// with a number is built from the very days the pages show.

const PL_WEEKDAY_PLURAL = ["Niedziele", "Poniedziałki", "Wtorki", "Środy", "Czwartki", "Piątki", "Soboty"];
const PL_WEEKDAY_ACC = ["niedzielę", "poniedziałek", "wtorek", "środę", "czwartek", "piątek", "sobotę"];

const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const zl = formatPlnWhole;
const ratioPl = (v: number) => v.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratioEn = (v: number) => v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function days(src: DemoSource, start: string, end: string): DemoDay[] {
  const out: DemoDay[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) {
    const v = src.day(d);
    if (v) out.push(v);
  }
  return out;
}
const total = (list: DemoDay[], pick: (d: DemoDay) => number) => list.reduce((a, d) => a + pick(d), 0);

/** "o 12% więcej niż" / "o 5% mniej niż" / "tyle samo co" + the rounded %. */
function changePl(cur: number, prev: number): string | null {
  if (prev <= 0) return null;
  const p = Math.round((cur / prev - 1) * 100);
  if (p === 0) return "tyle samo co";
  return p > 0 ? `o ${p}% więcej niż` : `o ${-p}% mniej niż`;
}
function changeEn(cur: number, prev: number): string | null {
  if (prev <= 0) return null;
  const p = Math.round((cur / prev - 1) * 100);
  if (p === 0) return "the same as";
  return p > 0 ? `${p}% more than` : `${-p}% less than`;
}

/** Where the season stands today, for the closing advice. */
function seasonMoment(today: string): "before_bf" | "bf" | "gifts" | "after" | "rest" {
  const bf = blackFridayOf(Number(today.slice(0, 4)));
  const toBf = diffDaysIso(today, bf);
  const md = today.slice(5);
  if (toBf > 0 && toBf <= 35) return "before_bf";
  if (toBf <= 0 && toBf >= -4) return "bf";
  if (md >= "11-20" && md <= "12-19") return "gifts";
  if (md >= "12-20" && md <= "12-31") return "after";
  return "rest";
}

/**
 * The overview's "Podsumowanie AI" for the last 7 complete days (the real
 * cron's window), from the demo's days.
 */
export function demoAiSummary(src: DemoSource, lang: DemoLang, now = new Date()): AiSummary {
  const en = lang === "en";
  const today = src.today;
  const end = addDaysIso(today, -1);
  const start = addDaysIso(today, -7);
  const week = days(src, start, end);
  const before = days(src, addDaysIso(start, -7), addDaysIso(start, -1));
  const rev = total(week, (d) => d.revenue);
  const orders = total(week, (d) => d.orders);
  const spend = total(week, (d) => d.spend);
  const roas = spend > 0 ? rev / spend : 0;

  // The campaign the platforms credit with the most purchases this week.
  let top: { name: string; provider: string; conv: number } | null = null;
  for (const c of src.campaigns) {
    let conv = 0;
    for (let d = start; d <= end; d = addDaysIso(d, 1)) conv += src.campaignDay(c.id, d)?.conversions ?? 0;
    if (conv > 0 && (!top || conv > top.conv)) top = { name: campaignName(c, lang), provider: c.provider === "meta_ads" ? "Meta" : "Google", conv };
  }
  const moment = seasonMoment(today);
  let text: string;
  if (en) {
    const ch = changeEn(rev, total(before, (d) => d.revenue));
    const advice: Record<typeof moment, string> = {
      before_bf: "Recommendation: before Black Friday, move budget to the campaigns with the best return and build remarketing lists now.",
      bf: "Recommendation: keep the budgets up through Cyber Monday - this is the year's busiest week.",
      gifts: "Recommendation: say clearly in the ads until when a gift still arrives before Christmas.",
      after: "Recommendation: keep remarketing for the after-Christmas sales and cut prospecting until January.",
      rest: "Recommendation: shift some budget to the campaigns with the best return and keep remarketing running.",
    };
    text = [
      `In the last 7 days the shop sold ${zl(rev)} (${formatNumberPL(orders)} ${orders === 1 ? "order" : "orders"})${ch ? ` - ${ch} the week before` : ""}.`,
      `The ads cost ${zl(spend)}, and every 1 zł spent brought back ${ratioEn(roas)} zł of sales.`,
      top ? `The most purchases from ads came from "${top.name}" (${top.provider}).` : "",
      advice[moment],
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    const ch = changePl(rev, total(before, (d) => d.revenue));
    const advice: Record<typeof moment, string> = {
      before_bf: "Przed Black Friday warto przesunąć budżet na kampanie z najlepszym zwrotem i już teraz budować listy remarketingowe.",
      bf: "Do Cyber Monday warto utrzymać wyższe budżety - to najmocniejszy tydzień roku.",
      gifts: "Warto wyraźnie mówić w reklamach, do kiedy prezent dotrze przed Świętami.",
      after: "Po Świętach warto zostawić remarketing na wyprzedaże i ograniczyć pozyskiwanie nowych klientów do stycznia.",
      rest: "Warto omówić przesunięcie części budżetu na kampanie z najlepszym zwrotem.",
    };
    text = [
      `W ostatnich 7 dniach sklep sprzedał za ${zl(rev)} (${formatNumberPL(orders)} ${plPlural(orders, "zamówienie", "zamówienia", "zamówień")})${ch ? ` - ${ch} tydzień wcześniej` : ""}.`,
      `Na reklamy poszło ${zl(spend)}, a każda złotówka wróciła jako ${ratioPl(roas)} zł sprzedaży.`,
      top ? `Najwięcej zakupów z reklam przyniosła kampania „${top.name}” (${top.provider}).` : "",
      advice[moment],
    ]
      .filter(Boolean)
      .join(" ");
  }
  return {
    summaryText: text,
    // Generated "this morning", like the daily cron.
    generatedAt: lastDailyRun(today, now),
    periodStart: start,
    periodEnd: end,
  };
}

/** The AI analysis "runs" daily at 06:10 Warsaw time; before that hour the latest one is yesterday's. */
export function lastDailyRun(today: string, now = new Date()): string {
  const run = fromZonedTime(`${today}T06:10:00`, "Europe/Warsaw");
  const latest = run.getTime() <= now.getTime() ? run : fromZonedTime(`${addDaysIso(today, -1)}T06:10:00`, "Europe/Warsaw");
  return latest.toISOString();
}

/** Sprzedaż's "Analiza AI", from the demo's last 30 days (and last year's, when there is one). */
export function demoEcomAnalysis(
  src: DemoSource,
  settings: Pick<EcomSettings, "marginPct" | "revenueIncludesVat">,
  topProducts: string[]
): EcomAnalysis {
  const today = src.today;
  const end = addDaysIso(today, -1);
  const start = addDaysIso(end, -29);
  const month = days(src, start, end).filter((d) => d.hasSales);
  const n = Math.max(1, month.length);
  const rev = total(month, (d) => d.revenue);
  const orders = total(month, (d) => d.orders);
  const spend = total(month, (d) => d.spend);
  const roas = spend > 0 ? rev / spend : 0;
  const aov = orders > 0 ? rev / orders : 0;
  const profit = computeProfit(rev, spend, settings);
  const breakEven = profit?.breakEvenRoas ?? null;

  // Year over year on the same 30 days (52 weeks back), when last year is there.
  const ly = days(src, addDaysIso(start, -364), addDaysIso(end, -364)).filter((d) => d.hasSales);
  const lyRev = ly.length >= 24 ? total(ly, (d) => d.revenue) : null;
  const yoy = lyRev && lyRev > 0 ? Math.round((rev / lyRev - 1) * 100) : null;

  const moment = seasonMoment(today);
  const verdict =
    breakEven === null
      ? ""
      : roas >= breakEven * 1.2
        ? "a reklamy zarabiają z zapasem"
        : roas >= breakEven
          ? "a reklamy się zwracają, choć bez dużego zapasu"
          : "ale przy tej marży reklamy jeszcze na siebie nie zarabiają";
  const growth =
    yoy === null
      ? "Sprzedaż z ostatnich 30 dni"
      : yoy >= 0
        ? `Sprzedaż z ostatnich 30 dni jest o ${yoy}% wyższa niż rok temu`
        : `Sprzedaż z ostatnich 30 dni jest o ${-yoy}% niższa niż rok temu`;
  const lead =
    yoy === null
      ? `${growth} to ${zl(rev)}${verdict ? `, ${verdict}` : ""}`
      : `${growth}${verdict ? `, ${verdict}` : ""}`;
  const seasonTail: Record<ReturnType<typeof seasonMoment>, string> = {
    before_bf: " - przed Black Friday to dobry moment na przygotowanie budżetu i list remarketingowych.",
    bf: " - trwa najmocniejszy tydzień roku.",
    gifts: " - teraz liczy się dowiezienie prezentów przed Świętami.",
    after: " - po Świętach czas na wyprzedaże.",
    rest: ".",
  };
  const headline = `${lead}${seasonTail[moment]}`;

  const products = topProducts.slice(0, 3);
  const productList =
    products.length === 0 ? "" : products.length === 1 ? products[0] : `${products.slice(0, -1).join(", ")} i ${products[products.length - 1]}`;
  const ordersPerDay = orders / n;
  const performance = [
    `W ostatnich 30 dniach sklep sprzedawał średnio za ok. ${zl(rev / n)} dziennie (${formatNumberPL(ordersPerDay)} ${plPlural(ordersPerDay, "zamówienie", "zamówienia", "zamówień")} dziennie, średnio ${zl(aov)} na zamówienie).`,
    `Na każdą złotówkę wydaną na reklamy wraca ok. ${ratioPl(roas)} zł przychodu${breakEven ? `, a próg opłacalności przy Twojej marży to ${ratioPl(breakEven)} zł` : ""}.`,
    productList ? `Najlepiej sprzedają się: ${productList}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Peaks found in the data.
  const peaks: EcomAnalysis["peaks"] = [];
  const byWeekday = new Array<{ rev: number; n: number }>(7).fill({ rev: 0, n: 0 }).map(() => ({ rev: 0, n: 0 }));
  for (const d of days(src, addDaysIso(end, -27), end).filter((x) => x.hasSales)) {
    const w = byWeekday[weekdayOf(d.date)];
    w.rev += d.revenue;
    w.n += 1;
  }
  const avgs = byWeekday.map((w, i) => ({ i, avg: w.n ? w.rev / w.n : 0 })).filter((w) => w.avg > 0);
  if (avgs.length >= 5) {
    const best = avgs.reduce((a, b) => (b.avg > a.avg ? b : a));
    const worst = avgs.reduce((a, b) => (b.avg < a.avg ? b : a));
    const more = Math.round((best.avg / worst.avg - 1) * 100);
    if (more >= 5) peaks.push({ label: PL_WEEKDAY_PLURAL[best.i], note: `średnio o ${more}% więcej sprzedaży niż w ${PL_WEEKDAY_ACC[worst.i]}` });
  }
  const bestDay = month.reduce<DemoDay | null>((a, d) => (!a || d.revenue > a.revenue ? d : a), null);
  if (bestDay) peaks.push({ label: dayLabelPl(bestDay.date), note: `najlepszy dzień ostatnich 30 dni: ${zl(bestDay.revenue)}` });
  const lyBf = blackFridayOf(Number(today.slice(0, 4)) - 1);
  const lyBfDay = src.day(lyBf);
  const lyNov = days(src, `${lyBf.slice(0, 4)}-11-01`, `${lyBf.slice(0, 4)}-11-30`).filter((d) => d.hasSales);
  if (lyBfDay?.hasSales && lyNov.length >= 24) {
    const x = lyBfDay.revenue / (total(lyNov, (d) => d.revenue) / lyNov.length);
    peaks.push({
      label: "Black Friday rok temu",
      note: `${zl(lyBfDay.revenue)} - ${ratioPl(x)} razy tyle co przeciętny dzień listopada`,
    });
  }

  // Seasonality: last year's months when they're in the data.
  const lyYear = String(Number(today.slice(0, 4)) - 1);
  const monthRev = (m: string) => {
    const list = days(src, `${lyYear}-${m}-01`, addDaysIso(`${lyYear}-${m}-01`, m === "11" ? 29 : 30)).filter((d) => d.hasSales);
    return list.length >= 24 ? total(list, (d) => d.revenue) : null;
  };
  const oct = monthRev("10");
  const nov = monthRev("11");
  const dec = monthRev("12");
  const seasonality =
    oct && nov
      ? `Rok temu listopad przyniósł ${ratioPl(nov / oct)} razy tyle sprzedaży co październik${dec ? `, a grudzień ${ratioPl(dec / oct)} razy tyle` : ""}. W RTV i AGD najmocniejszy jest tydzień Black Friday, w grudniu klienci kupują prezenty mniej więcej do 19 grudnia, a w czerwcu, przy dużych turniejach, rośnie popyt na telewizory.`
      : "W RTV i AGD najmocniejszy jest tydzień Black Friday, w grudniu klienci kupują prezenty mniej więcej do 19 grudnia, a w czerwcu, przy dużych turniejach, rośnie popyt na telewizory. Styczeń to wyprzedaże.";

  // Market: where the sales come from.
  const countries = src.countries.filter((c) => c.revenueShare >= 0.01).slice(0, 4);
  const countryText = countries.map((c) => `${marketLabel(c.country)} ${Math.round(c.revenueShare * 100)}%`).join(", ");
  const market = `${countries.length > 1 ? `Sprzedaż według krajów: ${countryText}. ` : ""}Klienci porównują ceny w kilku sklepach i chętnie kupują na raty 0%, więc w reklamach dobrze działają cena, dostępność od ręki i darmowa dostawa z wniesieniem. W tygodniu Black Friday kliknięcia wyraźnie drożeją, bo reklamują się wszystkie sklepy z elektroniką.`;

  // Recommendations from the numbers.
  const recs: string[] = [];
  const meta = { rev: 0, spend: 0 };
  const google = { rev: 0, spend: 0 };
  const metaShare = src.channels.find((c) => c.channel === "meta")?.revenueShare ?? 0;
  const googleShare = src.channels.find((c) => c.channel === "google_ads")?.revenueShare ?? 0;
  meta.spend = total(month, (d) => d.meta.spend);
  google.spend = total(month, (d) => d.google.spend);
  meta.rev = rev * metaShare;
  google.rev = rev * googleShare;
  const mRoas = meta.spend > 0 ? meta.rev / meta.spend : 0;
  const gRoas = google.spend > 0 ? google.rev / google.spend : 0;
  if (mRoas > 0 && gRoas > 0) {
    const [hi, lo, hiR, loR] = gRoas >= mRoas ? ["Google", "Meta", gRoas, mRoas] : ["Meta", "Google", mRoas, gRoas];
    recs.push(
      hiR / loR >= 1.15
        ? `Przesunąć część budżetu z ${lo} na ${hi}: według GA4 ${hi} zwraca ${ratioPl(hiR)} zł na złotówkę, ${lo} ${ratioPl(loR)} zł.`
        : `Utrzymać podział budżetu między Google i Meta - według GA4 obie platformy zwracają podobnie (ok. ${ratioPl((hiR + loR) / 2)} zł na złotówkę).`
    );
  }
  const abroad = countries.find((c) => c.country !== "PL" && c.revenueShare >= 0.03);
  if (abroad) recs.push(`Rozwijać kolejny rynek: ${marketLabel(abroad.country)} to już ${Math.round(abroad.revenueShare * 100)}% sprzedaży sklepu.`);
  const bf = blackFridayOf(Number(today.slice(0, 4)));
  recs.push(
    diffDaysIso(today, bf) > 21
      ? `Od ${dayLabelPl(addDaysIso(bf, -21))} budować listy remarketingowe pod Black Friday.`
      : "Wyraźnie komunikować ostatni dzień zamówień z dostawą przed Wigilią."
  );
  recs.push("Pokazywać w reklamach raty 0% i darmową dostawę z wniesieniem - przy dużym AGD to często przesądza o zakupie.");

  return { headline, performance, peaks, seasonality, market, recommendations: recs };
}

/** The demo's top products by name for a list of revenue-ranked rows. */
export const demoProductNames = (n: number) => DEMO_PRODUCTS.slice(0, n).map((p) => p.name);
