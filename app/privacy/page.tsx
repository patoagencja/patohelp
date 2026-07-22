import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Polityka prywatności — Pato Dashboard",
};

// Public privacy policy (required for Google OAuth verification).
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-slate-800">
      <h1 className="text-2xl font-semibold">Polityka prywatności</h1>
      <p className="mt-2 text-sm text-slate-500">patoagencja · Pato Dashboard</p>

      <div className="mt-8 space-y-5 text-sm leading-relaxed">
        <p>
          Pato Dashboard („Aplikacja") to wewnętrzne narzędzie raportowe agencji
          Pato, służące do prezentowania klientom danych z ich kont reklamowych
          (Meta Ads, Google Ads, TikTok Ads) oraz Google Analytics 4.
        </p>

        <h2 className="text-base font-semibold">Jakie dane przetwarzamy</h2>
        <p>
          Za zgodą właściciela konta pobieramy — wyłącznie w trybie do odczytu —
          statystyki kampanii i ruchu (wydatki, wyświetlenia, kliknięcia, CTR,
          CPC, sesje, dane demograficzne). Nie pobieramy danych osobowych
          użytkowników końcowych ani treści prywatnych.
        </p>

        <h2 className="text-base font-semibold">Wykorzystanie danych Google</h2>
        <p>
          Dostęp do interfejsów API Google (Google Ads, Google Analytics) jest
          używany wyłącznie do wyświetlania statystyk w panelu klienta. Dane nie
          są sprzedawane, udostępniane stronom trzecim ani wykorzystywane do
          celów reklamowych. Korzystanie z danych Google jest zgodne z
          <a
            className="text-indigo-600 underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            {" "}
            Google API Services User Data Policy
          </a>
          , w tym z wymogami Limited Use.
        </p>

        <h2 className="text-base font-semibold">Przechowywanie i bezpieczeństwo</h2>
        <p>
          Tokeny dostępu są przechowywane w postaci zaszyfrowanej. Dane
          statystyczne trzymamy w bazie z dostępem ograniczonym do właściwego
          klienta (Row Level Security). Dostęp odwołasz w każdej chwili,
          rozłączając integrację w panelu lub cofając zgodę w ustawieniach konta
          Google.
        </p>

        <h2 className="text-base font-semibold">Kontakt</h2>
        <p>
          W sprawach prywatności: kontakt@patoagencja.com
        </p>
      </div>
    </main>
  );
}
