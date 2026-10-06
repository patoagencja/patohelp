# Prompt do Claude Design - Pato Client Dashboard

Wklej całość poniżej do Claude Design (claude.ai/design). Dołącz zrzuty obecnej
wersji (Przegląd jasny/ciemny, Sprzedaż, Reklamy, telefon) i swoje benchmarki z Dribbble.

---

Zaprojektuj kompletny, nowoczesny UI webowej aplikacji "Pato Client Dashboard" - panelu
raportowego agencji marketingowej dla jej klientów. Ma wyglądać jak najlepsze aplikacje
z 2026 roku (poziom Linear, Stripe, Revolut, Apple Fitness/Health, najnowszy język Apple
Liquid Glass i Material 3 Expressive), ale przede wszystkim być PROSTY: osoba nietechniczna
(np. marketing managerka u klienta, która pokazuje panel zarządowi) ma w 5 sekund zrozumieć,
czy jest dobrze, i chcieć to pokazać dalej ("wow" na zarządzie).

## Kontekst produktu
- Klient loguje się i widzi swoje reklamy Meta + Google oraz ruch na stronie z Google
  Analytics 4 - w jednym miejscu, zamiast 5 paneli.
- Dwa typy klientów:
  1. "Zasięgowy" (np. DRE - producent drzwi): liczą się wydatki, kliknięcia, koszt
     kliknięcia, klikalność, wizyty, zaangażowanie. NIGDY nie pokazujemy przychodu ani ROAS.
  2. "Sklep" (e-commerce): przychód, zamówienia, zwrot z reklam (np. "5,0×"), średni koszyk.
- Język UI: polski. Kwoty w złotych, spacja jako separator tysięcy ("43 885 zł"),
  przecinek dziesiętny ("0,95 zł", "2,12%"). Daty "5 paź", "29.09-05.10".
- Klient nigdy nie widzi kosztów agencji, tylko swoje wydatki na reklamy.
- Język prosty, bez żargonu: "Koszt kliknięcia" zamiast "CPC" (skrót najwyżej jako mały
  dopisek), "Zwrot z reklam" zamiast "ROAS", "o 16% więcej niż wcześniej".
- Działa w trybie jasnym i ciemnym, na komputerze, tablecie i telefonie.
  Ma też tryb prezentacji (pełny ekran, slajd po slajdzie) i eksport do PDF.

## Nawigacja (zostaje)
- Desktop: lewy sidebar - logo klienta; Przegląd · (Sprzedaż - tylko sklepy) · Reklamy
  (podstrona Kreacje) · Strona www · Więcej (Alerty, Newsy, Słowniczek pojęć, Jak czytać
  panel). Agencja ma dodatkowo Ustawienia i listę klientów.
- Górny pasek: nazwa klienta / tytuł strony, "Zaktualizowano 5 min temu" z zieloną kropką,
  dzwonek z liczbą alertów, przycisk "Prezentuj", menu "…" (szukaj, przewodnik, PDF, motyw,
  wyloguj).
- Telefon: dolny pasek zakładek (max 4 + "Więcej" jako arkusz od dołu).

## Zasada każdej strony
Nagłówek (tytuł + jedno zdanie + wybór zakresu dat: 7 dni / 30 dni / 90 dni / Ten miesiąc /
Poprzedni / Własny) → max 4 kafelki z liczbami → JEDEN główny wykres → jedna lista/tabela →
jeden zwijany blok "Pokaż szczegóły" z resztą. Bez tabel na 20 kolumn i bez 15 wykresów.

## Ekrany do zaprojektowania (artboardy)
1. **Przegląd - desktop, jasny** (1440 px, strona przewijana), dane przykładowe:
   - Nagłówek "Przegląd", zdanie "Jak idą reklamy i strona - najważniejsze na jednym ekranie."
   - Blok podsumowania: status ("Wszystko idzie dobrze" / "Pilne: 2 rzeczy do sprawdzenia"),
     zdanie "Za 43 885 zł reklamy przyciągnęły 46 320 kliknięć, a strona miała łącznie
     36 586 wizyt.", komentarz tygodnia od AI (2 linie + "Czytaj dalej"), jedna linia alertu
     ("Skok wydatków dziś: 1 809 zł · PMAX | Ruch · Google" + "Zobacz").
   - 4 kafelki: Wydatki 43 885 zł (+11%), Kliknięcia 46 320 (+16%), Wizyty na stronie
     36 586 (+20%), Koszt kliknięcia 0,95 zł (7% taniej - to DOBRA zmiana). Każdy: zmiana vs
     poprzedni okres + "rok temu: …", mini-wykres. Kliknięcie kafelka przełącza główny wykres.
   - Główny wykres 30 dni (wybrana metryka, poprzedni okres przerywaną linią, znaczniki
     wydarzeń "1 Start kampanii", "2 Zwiększono budżet", "3 Wstrzymano").
   - "Plan miesiąca": budżet 9 216 zł z 50 000 zł, cel wizyt 7 253 z 42 500, cel kliknięć
     8 093 z 56 500 - z kreską "tu powinniśmy być dziś" i słownym statusem.
   - "Najważniejsze kampanie": 5 wierszy (BRAND | Świadomość | Reach - Meta - 8 777 zł -
     9 705 kliknięć - 0,90%; TRAFFIC | Ruch na stronę - Meta - 7 460 zł; SEARCH | Generyczne -
     Google - 7 022 zł; PMAX | Ruch - Google - 5 705 zł - "Do obejrzenia"; ENGAGEMENT |
     Instagram - Meta - 4 827 zł), status kropką + słowem.
   - Zwinięte "Pokaż szczegóły" (Dobre wiadomości, Rekordy, Co dla Ciebie zrobiliśmy).
2. **Przegląd - desktop, ciemny.**
3. **Przegląd - telefon** (390 px), jasny, z dolnym paskiem zakładek.
4. **Sprzedaż (sklep)** - kafelki Przychód 250 863 zł, Zamówienia 1 708, Zwrot z reklam 5,0×,
   Średni koszyk 147 zł; wykres "Sprzedaż dzień po dniu" vs rok temu; "Plan miesiąca"
   43 443 zł z 300 000 zł (prognoza 289 312 zł); top 5 produktów z paskami.
5. **Reklamy** - zakładki Kampanie | Kreacje; 4 kafelki (wydatki, kliknięcia, koszt
   kliknięcia, klikalność); wykres kosztu kliknięcia Meta vs Google; tabela kampanii
   (status, kampania, wydatki, kliknięcia, klikalność), "Pokaż wszystkie".
6. **Kreacje** - podium top 3 reklam (miniatura, wynik słownie np. "Najtańsze kliknięcia"),
   galeria 6 kolejnych.
7. **Strona www** - 3 kafelki (wizyty, zainteresowani %, wizyty dziennie), źródła ruchu
   (Google, Facebook, bezpośrednio, Instagram…) jako paski + top 5 podstron.
8. **Alerty** - grupy Pilne / Ważne / Informacja, każdy alert: gdzie, nagłówek, jedno zdanie,
   "Więcej" rozwija "Dlaczego to ważne" i "Co z tym robimy". Pusty stan: "Wszystko w porządku".
9. **Logowanie** (magic link - tylko e-mail, bez hasła).
10. **Stany**: ładowanie (szkielet), brak danych ("Pierwsze dane już spływają"),
    błąd sekcji, problem z połączeniem integracji (baner dla agencji).
11. **Arkusz design systemu**: kolory (z wartościami HEX/OKLCH dla jasnego i ciemnego),
    typografia (rodzina, rozmiary, wagi, interlinia), promienie, cienie, odstępy, ruch
    (czasy, easing), oraz komponenty: kafelek KPI (zwykły i wybrany), pigułka zmiany
    (wzrost dobry / wzrost zły / bez zmian), status kampanii, przełącznik segmentowy, przyciski
    (główny, drugorzędny, tekstowy, niebezpieczny), pasek postępu z kreską celu, półokrągły
    wskaźnik, tooltip wykresu, legenda, karta "Analiza AI", baner alertu, pozycja menu
    (aktywna/nieaktywna), dolny pasek zakładek, pola formularza, toast.

## Kierunek wizualny (punkt wyjścia - obecna wersja podoba się klientowi)
- Ciepłe, jasnoszare tło; białe karty bez obramowań, duże zaokrąglenie (~24 px), bardzo
  miękki cień.
- Prawie czarny jako kolor zaznaczenia (aktywne menu jako czarna pigułka z małą limonkową
  kropką, wybrany kafelek, główny przycisk).
- Jeden kolor przewodni: świeża zieleń/limonka = postęp i dobre wiadomości; oliwka/khaki
  jako drugi kolor. Wykresy w stonowanej palecie (szałwia, łupek, terakota, lawenda, khaki),
  nigdy tęcza. Szare wszystko, co nie jest najważniejsze.
- Wyróżnienia wzorem: ukośne paski w paskach postępu i w najlepszym słupku, reszta szara.
- Duże, pewne liczby; tytuły sekcji ~18 px semibold; etykiety wyciszone 13-14 px.
- Komentarz AI jako delikatna lawendowo-różowa karta z chipem "Analiza AI" i liczbami w
  małych chipach.
- Na górze Przeglądu delikatna "zorza" w kolorach akcentu i marki klienta (bez zdjęć).
- Unowocześnij to w duchu 2026: rozważ materiał szkła (Liquid Glass) TYLKO dla elementów
  pływających (górny pasek, dolny pasek zakładek, popovery, tooltipy) - nigdy pod gęstym
  tekstem; zaokrąglenia koncentryczne; ekspresyjna typografia liczb; płynne mikro-animacje
  (zmiana kafelka → morfing wykresu, liczby "dobiegające" do wartości); pływający dolny
  pasek na telefonie.

## Twarde wymagania
- Czytelność ponad efekt: kontrast WCAG AA, kolor nigdy nie jest jedynym sygnałem (zawsze
  strzałka lub słowo), cele dotykowe ≥ 44 px.
- Zielony = dobrze, czerwony = źle - ale "taniej" przy koszcie kliknięcia to dobrze
  (zielony ze strzałką w dół). Wydatki są neutralne (bez koloru dobra/zła).
- Logo i kolor marki klienta mogą się pojawić (sidebar, zorza), ale panel ma wyglądać
  spójnie dla każdego klienta.
- Wydruk/PDF: czysto, bez tła i cieni.
- Bez emoji, bez stockowych ilustracji, bez wymyślonych metryk.

## Co ma z tego wyjść
Artboardy powyżej + arkusz design systemu z dokładnymi wartościami (kolory jasny/ciemny,
rozmiary, promienie, cienie, czasy animacji), żeby developer mógł je 1:1 przenieść do
Tailwind CSS (zmienne CSS w :root i .dark). Przy każdym ekranie krótko: co się zmieniło
względem obecnej wersji i dlaczego.
