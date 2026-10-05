import { CreativesExplorer } from "@/components/dashboard/creatives/creatives-explorer";
import { getDemoDashboard } from "@/lib/demo/data";

export const dynamic = "force-dynamic";

export default function DemoFullKreacje({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const lang = searchParams.lang === "en" ? "en" : "pl";
  const en = lang === "en";
  const d = getDemoDashboard(lang);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">{en ? "Creatives" : "Kreacje"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {en
            ? `Which ads work best, and why · Meta · ${d.rangeLabel}`
            : `Które reklamy działają najlepiej i dlaczego · Meta · ${d.rangeLabel}`}
        </p>
      </div>

      <CreativesExplorer creatives={d.creativesFull} lang={lang} />
    </>
  );
}
