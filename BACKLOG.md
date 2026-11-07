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


## Pomysły (do wyboru)

- Asystent w telefonie, krok 2: poranne powiadomienie push ok. 8:00 ze skrótem dnia i najpilniejszym alertem (powiadomienia web push w zainstalowanej aplikacji, przełącznik „Powiadomienia”).
- Asystent w telefonie: natychmiastowy push przy pilnych alertach (skok wydatków, zamówienia spadły do zera, strona nie odpowiada).
- Asystent w telefonie: zainstalowana aplikacja sklepu otwiera się od razu na „Dziś”.
- Asystent w telefonie: „Zrobione” / „Pomiń” przy każdej akcji z „Co dziś robimy” i cotygodniowe podsumowanie „co zrobiliśmy”.
- Asystent w telefonie: wieczorne podsumowanie dnia (push albo Telegram): „dziś 14 200 zł, najlepszy produkt…”.
- „Co nowego od Twojej ostatniej wizyty”: kiedy klient wraca do panelu po kilku dniach, na górze Przeglądu krótki pasek: ile wydano i ile było kliknięć/wizyt od jego ostatniej wizyty, nowe rekordy, nowe i zamknięte alerty. Zapamiętywać datę ostatniej wizyty per użytkownik. Znika po kliknięciu „OK”.
- „Zapytaj nas” przy każdym kafelku, wykresie i kampanii: klient wpisuje pytanie („czemu w środę spadło?”), a ono trafia mailem do opiekuna z agencji, z linkiem do tego miejsca w panelu i wybranym zakresem dat. W panelu agencji lista pytań z odpowiedzią „odpisaliśmy”.
- „Gdzie przepalamy budżet”: na stronie Reklamy krótka lista kampanii i zestawów reklam, które w wybranym okresie wydały sporo, a dały wyraźnie gorszy wynik niż średnia klienta (drogie kliknięcie, niska klikalność), z prostym zdaniem „co z tym robimy”. Liczone z danych, które już są, bez AI. Dla klientów wizerunkowych tylko kliknięcia i ruch, bez sprzedaży.
- (Większe, na kilka tygodni) Akceptacja nowych kreacji w panelu: agencja wrzuca projekty reklam, klient ogląda je w zakładce „Do akceptacji” i klika „Akceptuję” albo dopisuje uwagi. Pliki w Supabase Storage, powiadomienie mailem do agencji. Zrobić w kilku małych PR-ach.
- Szybszy widok 30 dni dla dużych kont (OLX): użyć funkcji z migracji 0043 także dla zakresu 30 dni (`LONG_RANGE_DAYS`), jeśli 0043 jest już wgrana.

## W toku (PR)


## Zrobione

- Meta: kompletność historii per konto (klienci z wieloma kontami, DRE).
- Strażnik sklepu: strona nie odpowiada (sprawdzanie z Supabase co 5 min) oraz Analytics / koszyk / piksel Meta przestały spływać.
- „Dziś” — asystent e-commerce w telefonie: poranny skrót, na co uważać, co dziś robimy.
- Mądrzejsze alerty: serie spadków na tle tego samego dnia tygodnia, z podpowiedzią co sprawdzić.
- Miesięczne podsumowanie mailem („Twój październik w skrócie”).
- Pobierz do Excela przy tabelach.
- Prasówka (Newsy) generuje się rano bez przekraczania czasu.
- Testy kreacji prostym językiem (alerty i werdykty przy reklamach).
- Panel jako aplikacja na telefonie (ikona na ekranie głównym, „Zainstaluj aplikację” w menu).
