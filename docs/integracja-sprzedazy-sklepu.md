# Kaleido - przekazywanie sprzedaży ze sklepu (dla programisty sklepu)

Panel Kaleido pokazuje prawdziwą sprzedaż sklepu obok wydatków na reklamy
(Meta, Google). Meta i Google liczą to samo zamówienie każda u siebie, więc
dopiero dane ze sklepu mówią, ile reklamy naprawdę przynoszą. Potrzebujemy
**dziennej sprzedaży według kraju i produktu**, wysyłanej co godzinę.

Klucz API generuje agencja w Kaleido (Ustawienia klienta → Panel sprzedażowy
sklepu) i przekazuje go bezpiecznym kanałem. Klucz wygląda tak:
`kal_live_…` (52 znaki). Traktuj go jak hasło: nie umieszczaj w kodzie
frontendu ani w repozytorium.

## Żądanie

```
POST https://<adres panelu>/api/ingest/sales
Authorization: Bearer kal_live_...
Content-Type: application/json
```

```json
{
  "rows": [
    { "date": "2026-12-01", "market": "PL", "product": "Film od Mikołaja", "orders": 42, "revenue_pln": 2058.00, "pending_orders": 5, "pending_revenue_pln": 249.95 },
    { "date": "2026-12-01", "market": "DE", "product": "Film od Mikołaja", "orders": 9, "revenue_pln": 611.55 },
    { "date": "2026-12-01", "market": "PL", "product": "List od Mikołaja", "orders": 31, "revenue_pln": 1209.00 }
  ]
}
```

| Pole | Wymagane | Znaczenie |
|---|---|---|
| `date` | tak | Dzień **złożenia** zamówienia, `RRRR-MM-DD`, czas polski. Od 45 dni wstecz do jutra. |
| `market` | nie | Kod kraju: `PL`, `DE`, `IT`, `UK`, `FR`, `BR`, `US`… (`GB` → `UK`, `USA`/`COM` → `US`). Brak = „bez rynku”. |
| `product` | nie | Nazwa produktu, maks. 80 znaków, zawsze pisana tak samo. Brak = wszystkie produkty razem. |
| `orders` | tak | Liczba **opłaconych** zamówień z tego dnia (liczba całkowita ≥ 0). |
| `revenue_pln` | tak | Przychód brutto z opłaconych zamówień, w PLN (inne waluty przelicz na PLN), np. `1234.50`. |
| `pending_orders` | nie | Zamówienia złożone tego dnia, jeszcze **nieopłacone** (płatność do 10 dni). |
| `pending_revenue_pln` | nie | Ich wartość brutto w PLN. |

## Zasady

- **Wysyłaj co godzinę ostatnie 14 dni.** Płatności „zapłać później” spływają
  do 10 dni po zamówieniu, więc liczby z ostatnich dni rosną.
- **Każde wysłanie zastępuje w całości dni, które zawiera.** Wyślij zawsze
  komplet wierszy danego dnia: produkt/kraj pominięty w kolejnym wysłaniu
  znika z panelu (np. po zwrocie jedynego zamówienia).
- Jeden dzień wysyłaj na **jednym poziomie szczegółów**: albo wszystkie
  wiersze z produktem (i krajem), albo bez. Mieszanie zostanie odrzucone.
- Powtórzenia tego samego (dzień, kraj, produkt) w jednym żądaniu sumujemy.
- Maks. 5 000 wierszy i 2 MB na żądanie, maks. 120 żądań na godzinę.
- Historię starszą niż 45 dni (np. poprzedni sezon) agencja wgrywa plikiem
  CSV w ustawieniach: `data;rynek;produkt;zamowienia;przychod_pln`.

## Odpowiedzi

| Kod | Znaczenie |
|---|---|
| `200` | `{"ok":true,"rows":3,"dates":["2026-12-01","2026-12-01"]}` - zapisane. |
| `400` | `{"ok":false,"error":"…","issues":[{"path":"rows.0.date","message":"…"}]}` - nic nie zapisano, popraw wskazane pola. |
| `401` | Zły lub wyłączony klucz. |
| `413` | Za duże żądanie - podziel dane. |
| `429` | Za dużo żądań - wysyłaj raz na godzinę. |
| `5xx` | Chwilowy problem po naszej stronie - ponów przy następnym uruchomieniu. |

## Przykład

```bash
curl -X POST "https://<adres panelu>/api/ingest/sales" \
  -H "Authorization: Bearer $KALEIDO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"date":"2026-12-01","market":"PL","product":"Film od Mikołaja","orders":42,"revenue_pln":2058.00}]}'
```
