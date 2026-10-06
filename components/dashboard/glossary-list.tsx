import { BookOpen, Megaphone, MousePointerClick, ShoppingBag } from "lucide-react";

import { GLOSSARY, type GlossaryKey } from "@/lib/dashboard/glossary";

// Grouped the way a client thinks about it, not the way platforms do:
// "what the ads did", "what happened on the site", "what the shop earned".
const GROUPS: Array<{
  title: string;
  icon: typeof Megaphone;
  keys: GlossaryKey[];
  shopOnly?: boolean;
}> = [
  {
    title: "Reklamy",
    icon: Megaphone,
    keys: ["spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm"],
  },
  {
    title: "Strona internetowa",
    icon: MousePointerClick,
    keys: ["sessions", "engagementRate", "conversions"],
  },
  {
    title: "Sklep",
    icon: ShoppingBag,
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
  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="h-6 w-6 text-primary" aria-hidden />
          Słowniczek
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Wszystkie pojęcia z panelu wyjaśnione prostymi słowami - z przykładem i
          podpowiedzią, czy wzrost to dobra wiadomość. Skróty w nawiasach to
          nazwy, których używają platformy reklamowe.
        </p>
      </div>

      {GROUPS.filter((g) => !g.shopOnly || isEcommerce).map((g) => (
        <section key={g.title} aria-labelledby={`slownik-${g.title}`}>
          <h2
            id={`slownik-${g.title}`}
            className="mb-3 flex items-center gap-2 text-base font-semibold"
          >
            <g.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            {g.title}
          </h2>
          <dl className="grid gap-3 md:grid-cols-2">
            {g.keys.map((k) => {
              const e = GLOSSARY[k];
              return (
                <div key={k} className="rounded-xl border border-border bg-card p-4">
                  <dt className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{e.name}</span>
                    {e.short ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {e.short}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {e.explain}
                  </dd>
                  <dd className="mt-2 text-xs font-medium text-foreground/80">
                    {GOOD_WHEN[e.goodWhen]}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
