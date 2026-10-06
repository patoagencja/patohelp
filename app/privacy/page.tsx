import type { Metadata } from "next";

import { Sky } from "@/components/ui/sky";

export const metadata: Metadata = {
  title: "Polityka prywatności — Pato Dashboard",
};

// Public privacy policy (required for Google OAuth verification).
export default function PrivacyPage() {
  return (
    <main className="relative isolate min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
      <Sky />
      <article className="glass mx-auto max-w-2xl rounded-glass p-6 sm:p-10">
      <p className="kick">Dokument · prywatność</p>
      <h1 className="mt-3 text-[2.25rem] font-light leading-tight tracking-[-0.045em] sm:text-[2.75rem]">Polityka prywatności</h1>
      <p className="mt-2 font-mono text-xs tracking-[0.06em] text-ink-3">patoagencja · Pato Dashboard</p>

      <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          Pato Dashboard („Aplikacja") to wewnętrzne narzędzie raportowe agencji
          Pato, służące do prezentowania klientom danych z ich kont reklamowych
          (Meta Ads, Google Ads, TikTok Ads) oraz Google Analytics 4.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Jakie dane przetwarzamy</h2>
        <p>
          Za zgodą właściciela konta pobieramy — wyłącznie w trybie do odczytu —
          statystyki kampanii i ruchu (wydatki, wyświetlenia, kliknięcia, CTR,
          CPC, sesje, dane demograficzne). Nie pobieramy danych osobowych
          użytkowników końcowych ani treści prywatnych.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Wykorzystanie danych Google</h2>
        <p>
          Dostęp do interfejsów API Google (Google Ads, Google Analytics) jest
          używany wyłącznie do wyświetlania statystyk w panelu klienta. Dane nie
          są sprzedawane, udostępniane stronom trzecim ani wykorzystywane do
          celów reklamowych. Korzystanie z danych Google jest zgodne z
          <a
            className="font-medium text-primary underline underline-offset-2"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            {" "}
            Google API Services User Data Policy
          </a>
          , w tym z wymogami Limited Use.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Przechowywanie i bezpieczeństwo</h2>
        <p>
          Tokeny dostępu są przechowywane w postaci zaszyfrowanej. Dane
          statystyczne trzymamy w bazie z dostępem ograniczonym do właściwego
          klienta (Row Level Security). Dostęp odwołasz w każdej chwili,
          rozłączając integrację w panelu lub cofając zgodę w ustawieniach konta
          Google.
        </p>

        <h2 className="pt-2 text-[19px] font-medium tracking-[-0.025em] text-foreground">Kontakt</h2>
        <p>
          W sprawach prywatności: kontakt@patoagencja.com
        </p>
      </div>
      </article>
    </main>
  );
}
