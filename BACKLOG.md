# Lista pomysłów do panelu

Dopisuj pomysły jednym zdaniem, po ludzku, do sekcji „Do zrobienia”.
Kolejność = priorytet: im wyżej, tym szybciej. Przesuń punkt na górę, żeby był następny.

Co poniedziałek rano Claude bierze pierwszy punkt z „Do zrobienia”, robi go,
sprawdza testami i wystawia PR do akceptacji. Na produkcję wchodzi dopiero po
kliknięciu „Merge”.

## Do zrobienia

- Prasówka (Newsy) nie generuje się rano: endpoint `refresh-news` przy każdym wywołaniu przekracza limit czasu. Skrócić albo podzielić jego pracę, żeby kończył się w czasie.
- Meta: dzień historii pobrany przez jedno konto liczy się jako pobrany dla całego klienta, więc pozostałe konta tego dnia już nie dociągają (ważne przy klientach z wieloma kontami, np. DRE). Śledzić kompletność dnia per konto.
- Testy kreacji: alerty (`lib/alerts/creative-tests.ts`) i krótkie werdykty przy reklamach (`lib/ab/stats.ts`) dalej brzmią „marketingowo” („Wyłącz X… 99% szans”). Przepisać prostym językiem, jak resztę strony.
- Szybszy widok 30 dni dla dużych kont (OLX): użyć funkcji z migracji 0043 także dla zakresu 30 dni (`LONG_RANGE_DAYS`), jeśli 0043 jest już wgrana.

## W toku (PR)

## Zrobione
