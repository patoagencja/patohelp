import type { Metadata } from "next";

import { Sky } from "@/components/ui/sky";

export const metadata: Metadata = {
  title: "Warunki korzystania — Pato Dashboard",
};

// Public terms of service (referenced from Google OAuth consent screen).
export default function TermsPage() {
  return (
    <main className="relative isolate min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
      <Sky />
      <article className="glass mx-auto max-w-2xl rounded-glass p-6 sm:p-10">
      <p className="kick">Dokument · regulamin</p>
      <h1 className="mt-3 text-[2.25rem] font-light leading-tight tracking-[-0.045em] sm:text-[2.75rem]">Warunki korzystania</h1>
      <p className="mt-2 font-mono text-xs tracking-[0.06em] text-ink-3">patoagencja · Pato Dashboard</p>

      <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          Pato Dashboard („Aplikacja") to narzędzie raportowe agencji patoagencja,
          udostępniane klientom agencji w celu przeglądania danych z ich kont
          reklamowych (Meta Ads, Google Ads, TikTok Ads) oraz Google Analytics
          4 w jednym panelu.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Zakres usługi</h2>
        <p>
          Aplikacja służy wyłącznie do prezentacji statystyk. Dane pobierane są
          w trybie do odczytu i nie są modyfikowane po stronie kont reklamowych
          klienta. Dostęp do panelu wymaga zaproszenia i logowania.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Odpowiedzialność</h2>
        <p>
          Dane prezentowane w panelu pochodzą z zewnętrznych interfejsów API
          (Meta, Google, TikTok) i mają charakter poglądowy. patoagencja dokłada
          starań, aby były aktualne i zgodne z danymi źródłowymi, jednak nie
          ponosi odpowiedzialności za decyzje podjęte wyłącznie na ich podstawie.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Dostęp i rozwiązanie</h2>
        <p>
          Właściciel konta może w każdej chwili odłączyć integrację w panelu lub
          cofnąć zgodę w ustawieniach konta u dostawcy (Google, Meta, TikTok),
          co natychmiast wstrzymuje pobieranie danych.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Kontakt</h2>
        <p>W sprawach dotyczących usługi: kontakt@patoagencja.com</p>
      </div>
      </article>
    </main>
  );
}
