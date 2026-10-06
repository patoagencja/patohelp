import { Users } from "lucide-react";

import type { DemographicsData } from "@/lib/dashboard/demographics";
import { formatCompactPL } from "@/lib/dashboard/story";

import { outOfTen, ShareBars, type ShareRow } from "./share-bars";

// GA4 reports Polish regions with English names ("Masovian Voivodeship");
// a client reads "Mazowieckie".
const REGION_PL: Array<[string, string]> = [
  ["masovia", "Mazowieckie"],
  ["mazow", "Mazowieckie"],
  ["lower silesia", "Dolnośląskie"],
  ["silesia", "Śląskie"],
  ["lesser poland", "Małopolskie"],
  ["greater poland", "Wielkopolskie"],
  ["west pomerania", "Zachodniopomorskie"],
  ["kuyavian", "Kujawsko-pomorskie"],
  ["pomerania", "Pomorskie"],
  ["lodz", "Łódzkie"],
  ["łódź", "Łódzkie"],
  ["lublin", "Lubelskie"],
  ["subcarpathia", "Podkarpackie"],
  ["warmian", "Warmińsko-mazurskie"],
  ["holy cross", "Świętokrzyskie"],
  ["swietokrzyskie", "Świętokrzyskie"],
  ["świętokrzyskie", "Świętokrzyskie"],
  ["podlach", "Podlaskie"],
  ["podlaskie", "Podlaskie"],
  ["lubusz", "Lubuskie"],
  ["opole", "Opolskie"],
];

export function regionPL(name: string): string {
  const n = name.toLowerCase();
  if (n === "(not set)") return "Nieznany region";
  return REGION_PL.find(([k]) => n.includes(k))?.[1] ?? name;
}

function ageLabel(bucket: string): string {
  if (/^\d+\+$/.test(bucket)) return `${bucket} lat`;
  if (/^\d+-\d+$/.test(bucket)) return `${bucket.replace("-", "–")} lat`;
  return bucket === "unknown" ? "Wiek nieznany" : bucket;
}

const GENDER_PL: Record<string, string> = {
  female: "Kobiety",
  male: "Mężczyźni",
  unknown: "Nieznana",
};

const AGE_BARS = [
  "bg-indigo-300",
  "bg-indigo-400",
  "bg-indigo-500",
  "bg-indigo-600",
  "bg-indigo-700",
  "bg-indigo-800",
];

/**
 * "Kim są Twoi odbiorcy": age, gender and region in three glanceable cards.
 * Age/gender prefer Meta (people reached by ads) and fall back to GA4
 * (site visitors) - the caption says which, so nobody mixes them up.
 */
export function Audience({ data }: { data: DemographicsData }) {
  if (!data.hasData) return null;

  const ageRows: ShareRow[] = data.age
    .filter((a) => a.bucket !== "unknown")
    .map((a, i) => ({
      key: a.bucket,
      label: ageLabel(a.bucket),
      value: a.value,
      barClass: AGE_BARS[i % AGE_BARS.length],
    }));
  const ageTotal = ageRows.reduce((s, r) => s + r.value, 0);
  const topAge = [...ageRows].sort((a, b) => b.value - a.value)[0];

  const genderRows: ShareRow[] = data.gender
    .filter((g) => g.bucket.toLowerCase() !== "unknown")
    .map((g) => ({
      key: g.bucket,
      label: GENDER_PL[g.bucket.toLowerCase()] ?? g.bucket,
      value: g.value,
      barClass: g.bucket.toLowerCase() === "female" ? "bg-rose-400" : "bg-sky-500",
    }));
  const genderTotal = genderRows.reduce((s, r) => s + r.value, 0);
  const topGender = [...genderRows].sort((a, b) => b.value - a.value)[0];

  const geoRows: ShareRow[] = data.geo
    .filter((g) => g.bucket.toLowerCase() !== "(not set)")
    .slice(0, 6)
    .map((g) => ({
      key: g.bucket,
      label: regionPL(g.bucket),
      value: g.value,
      barClass: "bg-emerald-500",
    }));

  const sourceNote = (src: "meta" | "ga4" | null) =>
    src === "meta" ? "osoby, do których dotarły reklamy" : "osoby odwiedzające stronę";
  const unit = (n: number) => formatCompactPL(n);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-primary" />
          Kim są Twoi odbiorcy
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Wiek, płeć i region - żeby wiedzieć, do kogo naprawdę mówią reklamy.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {ageRows.length ? (
          <ShareBars
            headingLevel={3}
            title="Wiek"
            insight={
              topAge && ageTotal
                ? `Najliczniejsza grupa: ${topAge.label} (${Math.round(
                    (topAge.value / ageTotal) * 100
                  )}%) · ${sourceNote(data.ageSource)}.`
                : null
            }
            rows={ageRows}
            unit={unit}
            keepOrder
          />
        ) : null}
        {genderRows.length ? (
          <ShareBars
            headingLevel={3}
            title="Płeć"
            insight={
              topGender && genderTotal
                ? `${outOfTen(topGender.value / genderTotal)} to ${topGender.label.toLowerCase()} · ${sourceNote(
                    data.genderSource
                  )}.`
                : null
            }
            rows={genderRows}
            unit={unit}
          />
        ) : null}
        {geoRows.length ? (
          <ShareBars
            headingLevel={3}
            title="Skąd są goście · najczęstsze regiony"
            insight={`Najwięcej wizyt z: ${geoRows
              .slice(0, 3)
              .map((r) => r.label)
              .join(", ")}.`}
            rows={geoRows}
            unit={unit}
          />
        ) : null}
      </div>
    </section>
  );
}
