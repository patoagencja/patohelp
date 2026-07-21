import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Warunki korzystania — Pato Dashboard",
};

// Public terms of service (referenced from Google OAuth consent screen).
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-800">
      <h1 className="text-2xl font-semibold">Warunki korzystania</h1>
      <p className="mt-2 text-sm text-slate-500">Pato Agencja · Pato Dashboard</p>

      <div className="mt-8 space-y-5 text-sm leading-relaxed">
        <p>
          Pato Dashboard („Aplikacja") to narzędzie raportowe agencji Pato,
          udostępniane klientom agencji w celu przeglądania danych z ich kont
          reklamowych (Meta Ads, Google Ads, TikTok Ads) oraz Google Analytics
          4 w jednym panelu.
        </p>

        <h2 className="text-base font-semibold">Zakres usługi</h2>
        <p>
          Aplikacja służy wyłącznie do prezentacji statystyk. Dane pobierane są
          w trybie do odczytu i nie są modyfikowane po stronie kont reklamowych
          klienta. Dostęp do panelu wymaga zaproszenia i logowania.
        </p>

        <h2 className="text-base font-semibold">Odpowiedzialność</h2>
        <p>
          Dane prezentowane w panelu pochodzą z zewnętrznych interfejsów API
          (Meta, Google, TikTok) i mają charakter poglądowy. Agencja Pato dokłada
          starań, aby były aktualne i zgodne z danymi źródłowymi, jednak nie
          ponosi odpowiedzialności za decyzje podjęte wyłącznie na ich podstawie.
        </p>

        <h2 className="text-base font-semibold">Dostęp i rozwiązanie</h2>
        <p>
          Właściciel konta może w każdej chwili odłączyć integrację w panelu lub
          cofnąć zgodę w ustawieniach konta u dostawcy (Google, Meta, TikTok),
          co natychmiast wstrzymuje pobieranie danych.
        </p>

        <h2 className="text-base font-semibold">Kontakt</h2>
        <p>W sprawach dotyczących usługi: kontakt@patoagencja.com</p>
      </div>
    </main>
  );
}
