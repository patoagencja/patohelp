import PptxGenJS from "pptxgenjs";

import {
  numFmt,
  plnFmt,
  type ChannelMonth,
  type OlxSmReportData,
} from "@/lib/report/olx-sm-data";
import { AD_PROVIDER_LABEL, type AdProvider } from "@/lib/types";

// Monthly OLX Social Media report deck (7 slides), mirroring the agency's
// Google-Slides template v3: Cover / Metadata & Naming / Media Results /
// Creative Assets / Deep Dive / Learnings & Reco / AI Summary Block.
// Brand: OLX dark teal + teal accents, Arial, Courier New for the AI block.

const C = {
  dark: "002F34", // OLX brand dark teal
  dark2: "0B4A50",
  teal: "0D9488",
  tealLight: "5EEAD4",
  slate: "64748B",
  slateLight: "94A3B8",
  line: "E2E8F0",
  bg: "FFFFFF",
  panel: "F8FAFC",
  text: "1E293B",
  warn: "B45309",
  warnBg: "FEF3C7",
  okBg: "D1FAE5",
  ok: "047857",
};

const PROVIDER_SHORT: Record<AdProvider, string> = {
  meta_ads: "META",
  google_ads: "GOOGLE",
  tiktok_ads: "TIKTOK",
};

type Slide = PptxGenJS.Slide;

function contentHeader(
  slide: Slide,
  num: number,
  title: string,
  subtitle: string,
  foot: string
) {
  slide.background = { color: C.bg };
  slide.addText("OLX SOCIAL MEDIA REPORT", {
    x: 0.5, y: 0.28, w: 6, h: 0.3,
    fontFace: "Arial", fontSize: 10, color: C.slateLight, charSpacing: 2, bold: true,
  });
  slide.addText(String(num), {
    x: 12.2, y: 0.25, w: 0.6, h: 0.6, align: "center",
    fontFace: "Arial", fontSize: 22, bold: true, color: C.tealLight,
    fill: { color: C.dark }, // number chip
  });
  slide.addText(title, {
    x: 0.5, y: 0.62, w: 11, h: 0.55,
    fontFace: "Arial", fontSize: 26, bold: true, color: C.dark,
  });
  slide.addText(subtitle, {
    x: 0.5, y: 1.18, w: 11.5, h: 0.3,
    fontFace: "Arial", fontSize: 11, color: C.slate,
  });
  slide.addText(foot, {
    x: 0.5, y: 7.08, w: 12.3, h: 0.28,
    fontFace: "Arial", fontSize: 8.5, color: C.slateLight,
  });
}

function sectionLabel(slide: Slide, x: number, y: number, w: number, text: string) {
  slide.addText(text, {
    x, y, w, h: 0.26,
    fontFace: "Arial", fontSize: 9.5, bold: true, color: C.teal, charSpacing: 1.5,
  });
}

function statBlock(
  slide: Slide,
  x: number, y: number, w: number,
  label: string, value: string, note?: string
) {
  slide.addText(label, {
    x, y, w, h: 0.24,
    fontFace: "Arial", fontSize: 8.5, bold: true, color: C.slateLight, charSpacing: 1,
  });
  slide.addText(value, {
    x, y: y + 0.24, w, h: 0.42,
    fontFace: "Arial", fontSize: 17, bold: true, color: C.dark,
  });
  if (note) {
    slide.addText(note, {
      x, y: y + 0.66, w, h: 0.22,
      fontFace: "Arial", fontSize: 8, color: C.slate,
    });
  }
}

const cellBase = {
  fontFace: "Arial",
  fontSize: 9.5,
  color: C.text,
  valign: "middle" as const,
};
const headCell = (t: string): PptxGenJS.TableCell => ({
  text: t,
  options: { ...cellBase, bold: true, color: "FFFFFF", fill: { color: C.dark }, fontSize: 9 },
});
const cell = (t: string, opts: Partial<PptxGenJS.TableCellProps> = {}): PptxGenJS.TableCell => ({
  text: t,
  options: { ...cellBase, ...opts },
});

function flagChip(slide: Slide, x: number, y: number, w: number, flag: string) {
  const isOk = /^ok/i.test(flag);
  slide.addText(flag, {
    x, y, w, h: 0.3,
    fontFace: "Arial", fontSize: 9, bold: true,
    color: isOk ? C.ok : C.warn,
    fill: { color: isOk ? C.okBg : C.warnBg },
    align: "center", valign: "middle",
  });
}

export async function buildOlxSmDeck(data: OlxSmReportData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";

  const foot = `OLX Social Media Report · ${data.monthLabel} · patoagencja`;
  const channelLabel = (p: AdProvider) => AD_PROVIDER_LABEL[p];

  // ---------- Slide 1: Cover ----------
  {
    const s = pptx.addSlide();
    s.background = { color: C.dark };
    s.addText("OLX SOCIAL MEDIA", {
      x: 0.7, y: 1.5, w: 12, h: 0.8,
      fontFace: "Arial", fontSize: 40, bold: true, color: "FFFFFF",
    });
    s.addText(`Campaign Report · ${data.monthLabel}`, {
      x: 0.7, y: 2.35, w: 12, h: 0.5,
      fontFace: "Arial", fontSize: 18, color: C.tealLight,
    });

    const names = data.topCampaignNames.slice(0, 3);
    s.addText("KAMPANIE (TOP WG WYDATKÓW)", {
      x: 0.7, y: 3.3, w: 12, h: 0.3,
      fontFace: "Arial", fontSize: 10, bold: true, color: C.slateLight, charSpacing: 2,
    });
    names.forEach((c, i) => {
      s.addText(
        `${PROVIDER_SHORT[c.provider]}  ·  ${c.name}`,
        {
          x: 0.7, y: 3.65 + i * 0.38, w: 12, h: 0.34,
          fontFace: "Courier New", fontSize: 10.5, color: "FFFFFF",
        }
      );
    });

    const chips: Array<[string, string]> = [
      ["AGENCJA", "patoagencja (PATO)"],
      ["OKRES", data.periodLabel],
      ["BUDŻET ŁĄCZNIE", plnFmt(data.totalCost)],
      ["KANAŁY", data.channels.map((c) => channelLabel(c.provider)).join(" · ") || "-"],
    ];
    chips.forEach(([label, value], i) => {
      const x = 0.7 + i * 3.1;
      s.addText(label, {
        x, y: 5.35, w: 2.9, h: 0.26,
        fontFace: "Arial", fontSize: 9, bold: true, color: C.tealLight, charSpacing: 1.5,
      });
      s.addText(value, {
        x, y: 5.62, w: 2.9, h: 0.6,
        fontFace: "Arial", fontSize: 13, bold: true, color: "FFFFFF",
      });
    });

    s.addText(
      "Raport wygenerowany automatycznie z danych Meta / TikTok / Google Ads (Pato Dashboard).",
      { x: 0.7, y: 6.7, w: 12, h: 0.3, fontFace: "Arial", fontSize: 9, color: C.slateLight }
    );
  }

  // ---------- Slide 2: Metadata & Campaign Naming ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 1, "Metadata & Campaign Naming", "Segmenty nazwy kampanii · pełne naming strings per platforma", foot);

    sectionLabel(s, 0.5, 1.6, 6, "SEGMENTY NAZWY KAMPANII");
    const segRows: PptxGenJS.TableRow[] = [
      [headCell("Segment"), headCell("Wartość")],
      ...data.namingSegments.slice(0, 9).map((seg) => [cell(seg.segment, { bold: true }), cell(seg.value)]),
    ];
    if (segRows.length === 1) segRows.push([cell("-"), cell("Brak kampanii w okresie")]);
    s.addTable(segRows, {
      x: 0.5, y: 1.9, w: 5.6,
      border: { type: "solid", color: C.line, pt: 0.5 },
      rowH: 0.26,
    });

    sectionLabel(s, 6.5, 1.6, 6, "PEŁNE NAZWY KAMPANII PER PLATFORMA");
    const nameRows: PptxGenJS.TableRow[] = [
      [headCell("Kanał"), headCell("Pełna nazwa kampanii")],
      ...data.topCampaignNames.slice(0, 6).map((c) => [
        cell(channelLabel(c.provider), { bold: true }),
        cell(c.name, { fontFace: "Courier New", fontSize: 8 }),
      ]),
    ];
    s.addTable(nameRows, {
      x: 6.5, y: 1.9, w: 6.3,
      border: { type: "solid", color: C.line, pt: 0.5 },
      rowH: 0.3,
    });

    sectionLabel(s, 0.5, 5.15, 6, "BUDGET & CHANNELS");
    statBlock(s, 0.5, 5.5, 2.4, "BUDGET TOTAL", plnFmt(data.totalCost));
    data.channels.slice(0, 4).forEach((c, i) => {
      statBlock(
        s,
        3.1 + i * 2.5, 5.5, 2.3,
        PROVIDER_SHORT[c.provider],
        plnFmt(c.cost),
        `${((c.cost / Math.max(data.totalCost, 1)) * 100).toFixed(0)}% budżetu`
      );
    });
  }

  // ---------- Slide 3: Media Results ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 2, "Media Results", "KPI per kanał · headline KPIs · 3-month lookback", foot);

    sectionLabel(s, 0.5, 1.6, 6, `WYNIKI - ${data.monthLabel.toUpperCase()}`);
    const kpiRows: PptxGenJS.TableRow[] = [
      [
        headCell("Channel"), headCell("Reach*"), headCell("Impr."), headCell("Freq."),
        headCell("Clicks"), headCell("CPC"), headCell("CPM"), headCell("Cost"),
      ],
      ...data.channels.map((c: ChannelMonth) => [
        cell(channelLabel(c.provider), { bold: true }),
        cell(c.reach > 0 ? numFmt(c.reach) : "-"),
        cell(numFmt(c.impressions)),
        cell(c.frequency ? c.frequency.toFixed(2) : "-"),
        cell(numFmt(c.clicks)),
        cell(c.cpc ? plnFmt(Math.round(c.cpc)) : "-"),
        cell(c.cpm ? plnFmt(Math.round(c.cpm)) : "-"),
        cell(plnFmt(c.cost), { bold: true }),
      ]),
    ];
    s.addTable(kpiRows, {
      x: 0.5, y: 1.9, w: 12.3,
      border: { type: "solid", color: C.line, pt: 0.5 },
      rowH: 0.32,
    });
    s.addText("* Reach = suma dziennych zasięgów (bez deduplikacji między dniami).", {
      x: 0.5, y: 1.9 + 0.36 * (data.channels.length + 1) + 0.05, w: 12, h: 0.22,
      fontFace: "Arial", fontSize: 8, color: C.slateLight, italic: true,
    });

    sectionLabel(s, 0.5, 3.5, 6, "HEADLINE KPIS");
    statBlock(s, 0.5, 3.85, 2.9, "TOTAL REACH*", data.totalReach > 0 ? numFmt(data.totalReach) : "-", "wszystkie kanały, bez dedup.");
    statBlock(
      s, 3.6, 3.85, 2.9, "TOP CPM (NAJNIŻSZY)",
      data.bestCpm ? plnFmt(Math.round(data.bestCpm.cpm)) : "-",
      data.bestCpm ? channelLabel(data.bestCpm.provider) : undefined
    );
    statBlock(
      s, 6.7, 3.85, 2.9, "TOP FREQUENCY",
      data.topFrequency ? data.topFrequency.frequency.toFixed(2) : "-",
      data.topFrequency ? `${channelLabel(data.topFrequency.provider)} - obserwować` : undefined
    );
    statBlock(s, 9.8, 3.85, 2.9, "BUDGET SPENT", plnFmt(data.totalCost));

    sectionLabel(s, 0.5, 5.1, 6, "3-MONTH LOOKBACK");
    const lbHead: PptxGenJS.TableRow = [
      headCell("Channel"),
      ...(data.lookback[0]?.months.map((m) => headCell(m.label)) ?? []),
    ];
    const lbRows: PptxGenJS.TableRow[] = [
      lbHead,
      ...data.lookback.map((l) => [
        cell(channelLabel(l.provider), { bold: true }),
        ...l.months.map((m) =>
          cell(
            m.cpm ? `${plnFmt(Math.round(m.cpm))} CPM\nR: ${numFmt(m.reach)}` : "-",
            { fontSize: 8.5 }
          )
        ),
      ]),
    ];
    s.addTable(lbRows, {
      x: 0.5, y: 5.45, w: 12.3,
      border: { type: "solid", color: C.line, pt: 0.5 },
      rowH: 0.42,
    });
  }

  // ---------- Slide 4: Creative Assets ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 3, "Creative Assets", "Top kreacje wg wyświetleń i kliknięć (Meta)", foot);

    const cols: Array<{ title: string; items: typeof data.creativesReach }> = [
      { title: "META - TOP WYŚWIETLENIA", items: data.creativesReach },
      { title: "META - TOP KLIKNIĘCIA", items: data.creativesTraffic },
    ];

    cols.forEach((col, ci) => {
      const x = 0.5 + ci * 6.4;
      sectionLabel(s, x, 1.7, 6, col.title);
      if (col.items.length === 0) {
        s.addText("Brak danych o kreacjach (synchronizacja kreacji co 6h).", {
          x, y: 2.1, w: 5.9, h: 0.4, fontFace: "Arial", fontSize: 10, color: C.slate,
        });
        return;
      }
      col.items.forEach((cr, i) => {
        const y = 2.05 + i * 1.55;
        s.addShape("rect", {
          x, y, w: 6.1, h: 1.4,
          fill: { color: C.panel }, line: { color: C.line, width: 0.75 },
        });
        s.addText(`#${i + 1}`, {
          x: x + 0.15, y: y + 0.15, w: 0.6, h: 0.5,
          fontFace: "Arial", fontSize: 18, bold: true, color: C.teal,
        });
        s.addText(cr.name, {
          x: x + 0.8, y: y + 0.12, w: 5.1, h: 0.65,
          fontFace: "Arial", fontSize: 10, bold: true, color: C.text,
        });
        s.addText(`${cr.metricLabel}: ${cr.metricValue}`, {
          x: x + 0.8, y: y + 0.85, w: 5.1, h: 0.35,
          fontFace: "Courier New", fontSize: 10, color: C.dark,
        });
      });
    });

    s.addText(
      "TikTok / Google: miniatury i rankingi kreacji zostaną dodane po podłączeniu źródeł kreacji tych kanałów.",
      { x: 0.5, y: 6.75, w: 12.3, h: 0.26, fontFace: "Arial", fontSize: 8.5, color: C.slateLight, italic: true }
    );
  }

  // ---------- Slide 5: Deep Dive ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 4, "Deep Dive", "Analiza per kanał · flagi · pytania do OLX", foot);

    const colDefs = [
      { title: "META", flag: data.ai.metaFlag, bullets: data.ai.metaBullets },
      { title: "TIKTOK", flag: data.ai.tiktokFlag, bullets: data.ai.tiktokBullets },
      { title: "KAMPANIE / KATEGORIE", flag: data.ai.categoriesFlag, bullets: data.ai.categoriesBullets },
    ];
    colDefs.forEach((c, i) => {
      const x = 0.5 + i * 4.25;
      s.addText(c.title, {
        x, y: 1.7, w: 4, h: 0.3,
        fontFace: "Arial", fontSize: 13, bold: true, color: C.dark,
      });
      flagChip(s, x, 2.05, 4, c.flag);
      s.addText(
        c.bullets.map((b, bi) => ({
          text: b,
          options: {
            bullet: { code: "2022" },
            breakLine: bi < c.bullets.length - 1,
            fontFace: "Arial", fontSize: 9.5, color: C.text,
            paraSpaceAfter: 6,
          },
        })),
        { x, y: 2.5, w: 4, h: 3.6, valign: "top" }
      );
    });

    s.addShape("rect", {
      x: 0.5, y: 6.2, w: 12.3, h: 0.75,
      fill: { color: C.dark }, line: { color: C.dark, width: 0 },
    });
    s.addText(
      [
        { text: "PYTANIA / DECYZJE DLA OLX:  ", options: { bold: true, color: C.tealLight } },
        { text: data.ai.questions, options: { color: "FFFFFF" } },
      ],
      { x: 0.7, y: 6.25, w: 12, h: 0.65, fontFace: "Arial", fontSize: 10.5, valign: "middle" }
    );
  }

  // ---------- Slide 6: Learnings & Recommendations ----------
  {
    const s = pptx.addSlide();
    contentHeader(s, 5, "Learnings & Recommendations", "Co zadziałało · co robić dalej · priorytety", foot);

    sectionLabel(s, 0.5, 1.7, 6, "KEY LEARNINGS");
    sectionLabel(s, 6.9, 1.7, 6, "RECOMMENDATIONS");

    for (let i = 0; i < 3; i++) {
      const y = 2.05 + i * 1.55;
      const learning = data.ai.learnings[i] ?? "-";
      const reco = data.ai.recommendations[i] ?? { text: "-", priority: "MED" as const };

      s.addShape("rect", {
        x: 0.5, y, w: 6.1, h: 1.4,
        fill: { color: C.panel }, line: { color: C.line, width: 0.75 },
      });
      s.addText(`L${i + 1}`, {
        x: 0.65, y: y + 0.12, w: 0.7, h: 0.4,
        fontFace: "Arial", fontSize: 14, bold: true, color: C.teal,
      });
      s.addText(learning, {
        x: 1.35, y: y + 0.1, w: 5.1, h: 1.2,
        fontFace: "Arial", fontSize: 9.5, color: C.text, valign: "top",
      });

      s.addShape("rect", {
        x: 6.9, y, w: 5.9, h: 1.4,
        fill: { color: C.panel }, line: { color: C.line, width: 0.75 },
      });
      const isHigh = reco.priority === "HIGH";
      s.addText(reco.priority, {
        x: 7.02, y: y + 0.12, w: 0.85, h: 0.3, align: "center", valign: "middle",
        fontFace: "Arial", fontSize: 8.5, bold: true,
        color: isHigh ? "FFFFFF" : C.dark,
        fill: { color: isHigh ? C.teal : C.line },
      });
      s.addText(reco.text, {
        x: 8.0, y: y + 0.1, w: 4.7, h: 1.2,
        fontFace: "Arial", fontSize: 9.5, color: C.text, valign: "top",
      });
    }
  }

  // ---------- Slide 7: AI Summary Block ----------
  {
    const s = pptx.addSlide();
    s.background = { color: C.dark };
    s.addText("AI SUMMARY BLOCK", {
      x: 0.5, y: 0.4, w: 9, h: 0.5,
      fontFace: "Arial", fontSize: 24, bold: true, color: "FFFFFF",
    });
    s.addText("6", {
      x: 12.2, y: 0.4, w: 0.6, h: 0.6, align: "center",
      fontFace: "Arial", fontSize: 22, bold: true, color: C.dark,
      fill: { color: C.tealLight },
    });
    s.addText("Machine-readable - generowane automatycznie z Pato Dashboard.", {
      x: 0.5, y: 0.95, w: 11, h: 0.3,
      fontFace: "Arial", fontSize: 10, color: C.slateLight,
    });

    const spentParts = data.channels
      .map((c) => `${PROVIDER_SHORT[c.provider]}: ${plnFmt(c.cost)}`)
      .join(" · ");
    const kv: Array<[string, string]> = [
      ["REPORT_ID", `OLX_SM_${data.monthCode}`],
      ["PERIOD", data.periodLabel],
      ["CHANNELS", data.channels.map((c) => PROVIDER_SHORT[c.provider]).join(".") || "-"],
      ["BUDGET_SPENT", `${plnFmt(data.totalCost)} (${spentParts || "-"})`],
      ["TOP_CPM", data.bestCpm ? `${PROVIDER_SHORT[data.bestCpm.provider]}: ${plnFmt(Math.round(data.bestCpm.cpm))}` : "-"],
      ["TOP_REACH", data.totalReach > 0 ? `Total: ${numFmt(data.totalReach)} (bez dedup.)` : "-"],
      ["MAIN_LEARNING_1", data.ai.mainLearnings[0] ?? "-"],
      ["MAIN_LEARNING_2", data.ai.mainLearnings[1] ?? "-"],
      ["MAIN_LEARNING_3", data.ai.mainLearnings[2] ?? "-"],
      ["FLAG_ANOMALY", data.ai.flagAnomaly],
      ["TREND_VS_PREV_MONTH", data.ai.trendVsPrev],
      ["AGENCY_CODE", "PATO"],
    ];
    kv.forEach(([key, value], i) => {
      const y = 1.5 + i * 0.44;
      s.addText(`${key}:`, {
        x: 0.5, y, w: 3.4, h: 0.4,
        fontFace: "Courier New", fontSize: 10, bold: true, color: C.tealLight,
      });
      s.addText(value, {
        x: 4.0, y, w: 8.8, h: 0.4,
        fontFace: "Courier New", fontSize: 10, color: "FFFFFF",
      });
    });
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
