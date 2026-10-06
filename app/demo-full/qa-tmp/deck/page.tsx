// TEMPORARY QA harness - delete before finishing.
import {
  BarList,
  ContentSlide,
  CoverSlide,
  CreativesGrid,
  DECK_COLORS,
  DividerSlide,
  Donut,
  DualLineChart,
  LineChart,
  Stat,
} from "@/components/dashboard/report/deck";
import { ReportDeck } from "@/components/dashboard/report/report-deck";
import { getDemoDashboard } from "@/lib/demo/data";
import { formatMoneyPLN, formatNumberPL, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function QaDeck({ searchParams }: { searchParams: { s?: string } }) {
  const d = getDemoDashboard("pl");
  const foot = "lokalnepomidorki · 2026-09-06 - 2026-10-05";
  const axisNum = (v: number) => `${Math.round(v)}`;
  const slides = [
    <CoverSlide key="c" title="Raport" eyebrow="Kampania online" period="2026-09-06 - 2026-10-05" monogram="LOK" />,
    <DividerSlide key="d" title="Dane mediowe" subtitle="2026-09-06 - 2026-10-05" />,
    <ContentSlide key="k" title="Podsumowanie wyników" subtitle={d.rangeLabel} section="Dane mediowe" foot={foot}>
      <div className="grid h-full grid-cols-3 grid-rows-2 gap-4">
        <Stat label="Wydatki" value={formatMoneyPLN(d.kpis.spendMinorUnits.value)} sub="+11,1% vs poprz." tone="flat" />
        <Stat label="Kliknięcia" value={formatNumberPL(d.kpis.clicks.value)} sub="+16,3% vs poprz." tone="up" />
        <Stat label="Wizyty na stronie" value={formatNumberPL(d.kpis.sessions.value)} sub="+20,5% vs poprz." tone="up" />
        <Stat label="Klikalność (CTR)" value={formatPercent(d.kpis.ctr.value)} sub="+6,0% vs poprz." tone="up" />
        <Stat label="Koszt kliknięcia" value={formatMoneyPLN(d.kpis.cpcMinorUnits.value)} sub="-6,9% vs poprz." tone="up" />
        <Stat label="Konwersje" value={formatNumberPL(d.kpis.conversions.value)} sub="-2,0% vs poprz." tone="down" />
      </div>
    </ContentSlide>,
    <ContentSlide key="p" title="Podział wg platform" subtitle="Wydatki i kliknięcia: Meta / Google / TikTok" section="Dane mediowe" foot={foot}>
      <div className="grid h-full grid-cols-2 gap-10">
        <div className="flex flex-col">
          <p className="mb-3 text-sm font-medium text-muted-foreground">Udział w wydatkach</p>
          <div className="min-h-0 flex-1">
            <Donut centerLabel="wydatki" centerValue="43,9 tys. zł" items={[
              { label: "Meta Ads", value: 60, display: "26 331 zł", color: DECK_COLORS[0] },
              { label: "Google Ads", value: 40, display: "17 554 zł", color: DECK_COLORS[1] },
            ]} />
          </div>
        </div>
        <div>
          <p className="mb-3 text-sm font-medium text-muted-foreground">Kliknięcia</p>
          <BarList items={[
            { label: "Meta Ads", value: 26000, display: "26 000", color: DECK_COLORS[0] },
            { label: "Google Ads", value: 20320, display: "20 320", color: DECK_COLORS[1] },
          ]} />
        </div>
      </div>
    </ContentSlide>,
    <ContentSlide key="t" title="Najważniejsze kampanie" subtitle="Wg wydatków" section="Dane mediowe" foot={foot}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Platforma</th>
            <th className="py-2 pr-3 font-medium">Kampania</th>
            <th className="py-2 pr-3 text-right font-medium">Wydatki</th>
            <th className="py-2 pr-3 text-right font-medium">Kliknięcia</th>
            <th className="py-2 text-right font-medium">Klikalność</th>
          </tr>
        </thead>
        <tbody>
          {d.campaigns.map((c) => (
            <tr key={c.campaignId} className="border-b border-border last:border-0">
              <td className="py-2 pr-3 text-muted-foreground">{c.provider}</td>
              <td className="max-w-[22rem] truncate py-2 pr-3">{c.name}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyPLN(c.spendMinorUnits)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNumberPL(c.clicks)}</td>
              <td className="py-2 text-right tabular-nums">{formatPercent(c.ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ContentSlide>,
    <ContentSlide key="cr" title="Najlepsze reklamy" subtitle="Meta - wg wydatków" section="Dane mediowe" foot={foot}>
      <CreativesGrid items={d.creatives.slice(0, 4).map((c) => ({ name: c.adName, thumbnailUrl: null, spendDisplay: formatMoneyPLN(c.spendMinorUnits), ctrDisplay: c.ctr != null ? formatPercent(c.ctr) : "-" }))} />
    </ContentSlide>,
    <ContentSlide key="tr" title="Trend okresu" subtitle="Wydatki a wizyty na stronie" section="Dane mediowe" foot={foot}>
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <DualLineChart
            a={{ values: d.trend.map((t) => t.spendMinorUnits / 100), color: DECK_COLORS[0], format: axisNum }}
            b={{ values: d.trend.map((t) => t.sessions), color: DECK_COLORS[1], format: axisNum }}
          />
        </div>
      </div>
    </ContentSlide>,
    <ContentSlide key="w" title="Ruch na stronie" subtitle={d.rangeLabel} section="Dane Analytics" foot={foot}>
      <div className="grid h-full grid-cols-2 gap-8">
        <div className="grid grid-cols-2 content-start gap-4">
          <Stat label="Wizyty na stronie" value="36 586" />
          <Stat label="Zainteresowani goście" value="62%" />
          <Stat label="Nowi" value="22 683" />
          <Stat label="Powracający" value="13 903" />
        </div>
        <div className="flex flex-col">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Wizyty na stronie dzień po dniu</p>
          <div className="min-h-0 flex-1">
            <LineChart values={d.website.sessionsTrend.map((s) => s.sessions)} color={DECK_COLORS[0]} format={axisNum} />
          </div>
        </div>
      </div>
    </ContentSlide>,
    <DividerSlide key="e" title="Dziękujemy" subtitle="Przygotowane przez patoagencja · wygenerowano 6 paź 2026, 10:00" />,
  ];
  const start = Number(searchParams.s ?? 0);
  return (
    <div className="space-y-8">
      <ReportDeck clientSlug="demo" range="30d" rangeLabel={d.rangeLabel} foot={foot} shareMode>
        {[...slides.slice(start), ...slides.slice(0, start)]}
      </ReportDeck>
    </div>
  );
}
