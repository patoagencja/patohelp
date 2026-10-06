import { PageHeader } from "@/components/ui/page-header";
import { GLOSSARY, type GlossaryKey } from "@/lib/dashboard/glossary";

import { GlossarySearch, type GlossaryGroupView } from "./glossary-search";

// Grouped the way a client thinks about it, not the way platforms do:
// "what the ads did", "what happened on the site", "what the shop earned".
const GROUPS: Array<{ title: string; keys: GlossaryKey[]; shopOnly?: boolean }> = [
  {
    title: "Reklamy",
    keys: ["spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm"],
  },
  {
    title: "Strona internetowa",
    keys: ["sessions", "engagementRate", "conversions"],
  },
  {
    title: "Sklep",
    keys: ["revenue", "transactions", "aov", "roas", "poas"],
    shopOnly: true,
  },
];

const GOOD_WHEN: Record<string, string> = {
  higher: "Im więcej, tym lepiej",
  lower: "Im mniej, tym lepiej",
  neutral: "Zależy od planu",
};

/** Every metric in the panel explained in plain Polish, one place to look. */
export function GlossaryList({ isEcommerce }: { isEcommerce: boolean }) {
  // Plain data for the client-side search; the dictionary itself stays on
  // the server.
  const groups: GlossaryGroupView[] = GROUPS.filter((g) => !g.shopOnly || isEcommerce).map(
    (g) => ({
      title: g.title,
      entries: g.keys.map((k) => {
        const e = GLOSSARY[k];
        return {
          key: k,
          name: e.name,
          short: e.short ?? null,
          explain: e.explain,
          goodWhen: GOOD_WHEN[e.goodWhen],
          direction: e.goodWhen,
        };
      }),
    })
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <span className="kick">
            Pomoc · {groups.reduce((n, g) => n + g.entries.length, 0)} pojęć
          </span>
        }
        title="Słowniczek pojęć"
        description="Wszystkie pojęcia z panelu wyjaśnione prostymi słowami, z podpowiedzią, czy wzrost to dobra wiadomość."
      />
      <GlossarySearch groups={groups} />
    </div>
  );
}
