import { formatNumberPL } from "@/lib/utils";

import { outOfTen, ShareBars } from "./share-bars";

export function NewVsReturning({
  data,
  lang = "pl",
}: {
  data: { newUsers: number; returningUsers: number };
  lang?: "pl" | "en";
}) {
  const en = lang === "en";
  const total = data.newUsers + data.returningUsers;
  const newShare = total > 0 ? data.newUsers / total : 0;
  // Spin it the way it matters to the client: new people = reach working,
  // returning people = the brand is remembered.
  const insight =
    total > 0 && !en
      ? newShare >= 0.5
        ? `${outOfTen(newShare)} gości to nowe osoby - reklamy docierają do ludzi, którzy wcześniej nie znali marki.`
        : `${outOfTen(1 - newShare)} gości wraca na stronę - marka zostaje w pamięci.`
      : null;

  return (
    <ShareBars
      title={en ? "New vs returning" : "Nowi i powracający goście"}
      insight={insight}
      rows={[
        {
          key: "new",
          label: en ? "New users" : "Pierwszy raz na stronie",
          value: data.newUsers,
          barClass: "bg-indigo-500",
        },
        {
          key: "returning",
          label: en ? "Returning" : "Wracają kolejny raz",
          value: data.returningUsers,
          barClass: "bg-emerald-500",
        },
      ]}
      unit={(n) => `${formatNumberPL(n)} ${en ? "users" : "os."}`}
    />
  );
}
