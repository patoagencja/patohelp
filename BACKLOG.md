# Lista pomysłów do panelu

Co poniedziałek rano Claude bierze pierwszy punkt z „Do zrobienia”, robi go,
sprawdza testami i wystawia PR do akceptacji. Na produkcję wchodzi dopiero po
kliknięciu „Merge”. Claude robi TYLKO to, co jest w „Do zrobienia” — gdy ta
sekcja jest pusta, nic nie zmienia.

Żeby coś zrobić: przenieś punkt z „Pomysłów” do „Do zrobienia” (albo dopisz
własny jednym zdaniem). Kolejność w „Do zrobienia” = kolejność robienia.

Zasady dla każdego punktu: bez nowych kosztów AI (żadnych nowych wywołań
modelu), bez nowych bibliotek, klient widzi tylko swoje dane i swoje wydatki.

## Do zrobienia

- Miesięczne podsumowanie mailem: 1. dnia miesiąca klient dostaje maila „Twój październik w skrócie” (wydatki, kliknięcia, wizyty, najlepsza kampania i reklama, porównanie z poprzednim miesiącem) z linkiem do raportu w panelu. Teksty z gotowych szablonów, bez AI. Wysyłka jak przy tygodniowym mailu.
- Panel jako aplikacja na telefonie: ikona na ekranie głównym („Dodaj do ekranu początkowego”), własna nazwa i kolor, szybki start bez paska przeglądarki (manifest PWA w Next.js, bez nowych bibliotek).
- Testy kreacji: alerty (`lib/alerts/creative-tests.ts`) i krótkie werdykty przy reklamach (`lib/ab/stats.ts`) dalej brzmią „marketingowo” („Wyłącz X… 99% szans”). Przepisać prostym językiem, jak resztę strony.

## Pomysły (do wyboru)

- „Co nowego od Twojej ostatniej wizyty”: kiedy klient wraca do panelu po kilku dniach, na górze Przeglądu krótki pasek: ile wydano i ile było kliknięć/wizyt od jego ostatniej wizyty, nowe rekordy, nowe i zamknięte alerty. Zapamiętywać datę ostatniej wizyty per użytkownik. Znika po kliknięciu „OK”.
- „Zapytaj nas” przy każdym kafelku, wykresie i kampanii: klient wpisuje pytanie („czemu w środę spadło?”), a ono trafia mailem do opiekuna z agencji, z linkiem do tego miejsca w panelu i wybranym zakresem dat. W panelu agencji lista pytań z odpowiedzią „odpisaliśmy”.
- „Gdzie przepalamy budżet”: na stronie Reklamy krótka lista kampanii i zestawów reklam, które w wybranym okresie wydały sporo, a dały wyraźnie gorszy wynik niż średnia klienta (drogie kliknięcie, niska klikalność), z prostym zdaniem „co z tym robimy”. Liczone z danych, które już są, bez AI. Dla klientów wizerunkowych tylko kliknięcia i ruch, bez sprzedaży.
- Pobierz do Excela: przycisk przy tabelach (kampanie, reklamy, podstrony, produkty), który pobiera plik CSV z tym, co widać, w wybranym zakresie dat, z polskimi nagłówkami i kwotami w złotych.
- (Większe, na kilka tygodni) Akceptacja nowych kreacji w panelu: agencja wrzuca projekty reklam, klient ogląda je w zakładce „Do akceptacji” i klika „Akceptuję” albo dopisuje uwagi. Pliki w Supabase Storage, powiadomienie mailem do agencji. Zrobić w kilku małych PR-ach.
- Meta: dzień historii pobrany przez jedno konto liczy się jako pobrany dla całego klienta, więc pozostałe konta tego dnia już nie dociągają (ważne przy klientach z wieloma kontami, np. DRE). Śledzić kompletność dnia per konto.
- Szybszy widok 30 dni dla dużych kont (OLX): użyć funkcji z migracji 0043 także dla zakresu 30 dni (`LONG_RANGE_DAYS`), jeśli 0043 jest już wgrana.
- Prasówka (Newsy) nie generuje się rano: endpoint `refresh-news` przy każdym wywołaniu przekracza limit czasu. Skrócić albo podzielić jego pracę, żeby kończył się w czasie.

## W toku (PR)

## Zrobione
