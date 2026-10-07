import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateSales,
  dateBounds,
  dateRange,
  decodeCsvBytes,
  isIsoDate,
  isMissingTableError,
  mixedGranularityDate,
  normalizeDateInput,
  normalizeMarket,
  normalizeProduct,
  parseDecimal,
  parseSalesCsv,
  splitCsv,
  toMinorUnits,
  toNumberLoose,
} from "./parse.ts";

describe("normalizeMarket", () => {
  it("upper-cases and trims country codes", () => {
    assert.equal(normalizeMarket("pl"), "PL");
    assert.equal(normalizeMarket("  de "), "DE");
    assert.equal(normalizeMarket("BR"), "BR");
  });

  it("maps aliases to the codes we key on", () => {
    assert.equal(normalizeMarket("GB"), "UK");
    assert.equal(normalizeMarket("gb"), "UK");
    assert.equal(normalizeMarket("USA"), "US");
    assert.equal(normalizeMarket("com"), "US");
    assert.equal(normalizeMarket(".com"), "US");
  });

  it("keeps the region of a locale", () => {
    assert.equal(normalizeMarket("pt-BR"), "BR");
    assert.equal(normalizeMarket("en_GB"), "UK");
  });

  it("returns '' for anything that is not a 2-3 letter code", () => {
    assert.equal(normalizeMarket("Polska"), "");
    assert.equal(normalizeMarket(""), "");
    assert.equal(normalizeMarket("P"), "");
    assert.equal(normalizeMarket("PL1"), "");
    assert.equal(normalizeMarket(null), "");
    assert.equal(normalizeMarket(undefined), "");
    assert.equal(normalizeMarket(48), "");
  });
});

describe("normalizeProduct", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizeProduct("  List   od\tMikołaja "), "List od Mikołaja");
  });

  it("composes decomposed Unicode so both spellings share a key", () => {
    const decomposed = "Życzenia"; // Z + combining dot above
    assert.equal(normalizeProduct(decomposed), "Życzenia");
  });

  it("returns '' for missing values", () => {
    assert.equal(normalizeProduct(undefined), "");
    assert.equal(normalizeProduct(null), "");
  });
});

describe("parseDecimal", () => {
  it("reads plain numbers", () => {
    assert.equal(parseDecimal("12"), 12);
    assert.equal(parseDecimal("1234.5"), 1234.5);
    assert.equal(parseDecimal("-3"), -3);
  });

  it("reads Polish decimal comma and space grouping", () => {
    assert.equal(parseDecimal("1234,56"), 1234.56);
    assert.equal(parseDecimal("1 234,56"), 1234.56);
    assert.equal(parseDecimal("1 234,56 zł"), 1234.56);
    assert.equal(parseDecimal("99 PLN"), 99);
  });

  it("treats the last of mixed separators as the decimal one", () => {
    assert.equal(parseDecimal("1.234,56"), 1234.56);
    assert.equal(parseDecimal("1,234.56"), 1234.56);
  });

  it("treats a repeated separator as grouping", () => {
    assert.equal(parseDecimal("1,234,567"), 1234567);
    assert.equal(parseDecimal("1.234.567"), 1234567);
  });

  it("rejects non-numbers", () => {
    assert.equal(parseDecimal(""), null);
    assert.equal(parseDecimal("abc"), null);
    assert.equal(parseDecimal("12abc"), null);
    assert.equal(parseDecimal("1e5"), null);
    assert.equal(parseDecimal("-"), null);
  });
});

describe("toNumberLoose", () => {
  it("passes numbers and parses numeric strings", () => {
    assert.equal(toNumberLoose(5), 5);
    assert.equal(toNumberLoose("1234.50"), 1234.5);
    assert.equal(toNumberLoose("12,5"), 12.5);
  });

  it("leaves everything else for the schema to reject", () => {
    assert.equal(toNumberLoose("x"), "x");
    assert.equal(toNumberLoose(""), "");
    assert.equal(toNumberLoose(null), null);
    assert.equal(toNumberLoose(undefined), undefined);
  });
});

describe("dates", () => {
  it("normalizes spreadsheet date variants", () => {
    assert.equal(normalizeDateInput("2025-12-01"), "2025-12-01");
    assert.equal(normalizeDateInput(" 2025-12-01 "), "2025-12-01");
    assert.equal(normalizeDateInput("1.12.2025"), "2025-12-01");
    assert.equal(normalizeDateInput("01.12.2025"), "2025-12-01");
    assert.equal(normalizeDateInput("2025-12-01 00:00:00"), "2025-12-01");
    assert.equal(normalizeDateInput("2025-12-01T00:00:00.000Z"), "2025-12-01");
    // A real time of day stays as is, and fails validation later.
    assert.equal(normalizeDateInput("2025-12-01T13:00:00Z"), "2025-12-01T13:00:00Z");
    assert.equal(normalizeDateInput(20251201), 20251201);
  });

  it("accepts only real calendar days", () => {
    assert.equal(isIsoDate("2025-12-01"), true);
    assert.equal(isIsoDate("2024-02-29"), true);
    assert.equal(isIsoDate("2025-02-29"), false);
    assert.equal(isIsoDate("2025-13-01"), false);
    assert.equal(isIsoDate("2025-1-01"), false);
  });

  it("allows three years back to tomorrow", () => {
    assert.deepEqual(dateBounds(new Date("2026-10-07T22:30:00Z")), {
      min: "2023-10-07",
      max: "2026-10-08",
    });
    // Month end rolls over correctly.
    assert.deepEqual(dateBounds(new Date("2026-12-31T08:00:00Z")).max, "2027-01-01");
  });

  it("finds the min / max date of rows", () => {
    assert.equal(dateRange([]), null);
    assert.deepEqual(
      dateRange([{ date: "2025-12-03" }, { date: "2025-11-30" }, { date: "2025-12-01" }]),
      ["2025-11-30", "2025-12-03"]
    );
  });
});

describe("money and aggregation", () => {
  it("converts PLN to grosze", () => {
    assert.equal(toMinorUnits(2058), 205800);
    assert.equal(toMinorUnits(611.55), 61155);
    assert.equal(toMinorUnits(0.1 + 0.2), 30);
  });

  it("sums rows sharing date + market + product and sorts by key", () => {
    const out = aggregateSales([
      { date: "2025-12-02", market: "PL", product: "Film", orders: 1, revenueMinor: 100 },
      { date: "2025-12-01", market: "PL", product: "List", orders: 2, revenueMinor: 200 },
      { date: "2025-12-01", market: "PL", product: "List", orders: 3, revenueMinor: 350 },
      { date: "2025-12-01", market: "DE", product: "List", orders: 1, revenueMinor: 90 },
      { date: "2025-12-01", market: "", product: "", orders: 4, revenueMinor: 10 },
    ]);
    assert.deepEqual(out, [
      { date: "2025-12-01", market: "", product: "", orders: 4, revenueMinor: 10 },
      { date: "2025-12-01", market: "DE", product: "List", orders: 1, revenueMinor: 90 },
      { date: "2025-12-01", market: "PL", product: "List", orders: 5, revenueMinor: 550 },
      { date: "2025-12-02", market: "PL", product: "Film", orders: 1, revenueMinor: 100 },
    ]);
  });

  it("does not mutate its input", () => {
    const input = [
      { date: "2025-12-01", market: "PL", product: "", orders: 1, revenueMinor: 1 },
      { date: "2025-12-01", market: "PL", product: "", orders: 1, revenueMinor: 1 },
    ];
    aggregateSales(input);
    assert.equal(input[0].orders, 1);
  });
});

describe("splitCsv", () => {
  it("handles quotes, escaped quotes and embedded delimiters / line breaks", () => {
    const rows = splitCsv('a;"b;c";"say ""hi"""\r\n"multi\nline";x;y\n', ";");
    assert.deepEqual(rows, [
      { line: 1, cells: ["a", "b;c", 'say "hi"'] },
      { line: 2, cells: ["multi\nline", "x", "y"] },
    ]);
  });

  it("keeps the last row without a trailing newline", () => {
    assert.deepEqual(splitCsv("a,b\n1,2", ","), [
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["1", "2"] },
    ]);
  });
});

describe("parseSalesCsv", () => {
  it("parses the Polish format with semicolons and a BOM", () => {
    const res = parseSalesCsv(
      "﻿data;rynek;produkt;zamowienia;przychod_pln\r\n2025-12-01;PL;Film od Mikołaja;42;2058,00\r\n\r\n2025-12-01;DE;Film od Mikołaja;9;611,55\r\n"
    );
    assert.ok(res.ok);
    assert.deepEqual(res.records, [
      {
        line: 2,
        values: { date: "2025-12-01", market: "PL", product: "Film od Mikołaja", orders: "42", revenue_pln: "2058,00" },
      },
      {
        line: 4,
        values: { date: "2025-12-01", market: "DE", product: "Film od Mikołaja", orders: "9", revenue_pln: "611,55" },
      },
    ]);
  });

  it("accepts English headers, commas, any column order and Polish diacritics in headers", () => {
    const en = parseSalesCsv("orders,date,revenue_pln,market\n3,2025-12-01,149.97,gb\n");
    assert.ok(en.ok);
    assert.deepEqual(en.records[0].values, {
      date: "2025-12-01",
      market: "gb",
      product: "",
      orders: "3",
      revenue_pln: "149.97",
    });

    const pl = parseSalesCsv("Data;Rynek;Produkt;Zamówienia;Przychód PLN\n2025-12-01;PL;List;1;10\n");
    assert.ok(pl.ok);
    assert.equal(pl.records[0].values.revenue_pln, "10");
  });

  it("reads quoted decimal-comma amounts in comma-separated files", () => {
    const res = parseSalesCsv('date,market,product,orders,revenue_pln\n2025-12-01,PL,Film,3,"149,97"\n');
    assert.ok(res.ok);
    assert.equal(res.records[0].values.revenue_pln, "149,97");
  });

  it("names missing required columns", () => {
    const res = parseSalesCsv("data;rynek;produkt\n2025-12-01;PL;Film\n");
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error, /Wiersz 1: brak kolumn „zamowienia”, „przychod_pln”/);
  });

  it("points at the line with more fields than the header", () => {
    const res = parseSalesCsv("date,market,product,orders,revenue_pln\n2025-12-01,PL,Film,3,149,97\n");
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error, /^Wiersz 2: więcej pól niż kolumn/);
  });

  it("rejects empty files and header-only files", () => {
    assert.equal(parseSalesCsv("").ok, false);
    assert.equal(parseSalesCsv("\n  \n").ok, false);
    assert.equal(parseSalesCsv("data;zamowienia;przychod_pln\n\n").ok, false);
  });

  it("rejects a duplicated column", () => {
    const res = parseSalesCsv("data;date;zamowienia;przychod_pln\n");
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error, /„data” występuje dwa razy/);
  });
});

describe("decodeCsvBytes", () => {
  it("reads UTF-8", () => {
    assert.equal(decodeCsvBytes(new TextEncoder().encode("Mikołaj")), "Mikołaj");
  });

  it("falls back to Windows-1250 for Polish Excel exports", () => {
    // "Mikołaj" in Windows-1250: ł = 0xB3 (invalid as UTF-8 here).
    const bytes = new Uint8Array([0x4d, 0x69, 0x6b, 0x6f, 0xb3, 0x61, 0x6a]);
    assert.equal(decodeCsvBytes(bytes), "Mikołaj");
  });
});

describe("isMissingTableError", () => {
  it("recognises 'migration not run' codes only", () => {
    assert.equal(isMissingTableError({ code: "42P01" }), true);
    assert.equal(isMissingTableError({ code: "PGRST205" }), true);
    assert.equal(isMissingTableError({ code: "PGRST204" }), true);
    assert.equal(isMissingTableError({ code: "23505" }), false);
    assert.equal(isMissingTableError(null), false);
  });
});

describe("review fixes", () => {
  it("a lone separator before exactly three digits is a thousands group", () => {
    assert.equal(parseDecimal("1,234"), 1234);
    assert.equal(parseDecimal("12.345"), 12345);
    assert.equal(parseDecimal("0,500"), 0.5);
    assert.equal(parseDecimal("49,99"), 49.99);
  });

  it("a day sent both per product and as all products is rejected", () => {
    assert.equal(
      mixedGranularityDate([
        { date: "2026-12-01", market: "PL", product: "Film" },
        { date: "2026-12-01", market: "PL", product: "" },
      ]),
      "2026-12-01"
    );
    assert.equal(
      mixedGranularityDate([
        { date: "2026-12-01", market: "PL", product: "Film" },
        { date: "2026-12-02", market: "PL", product: "" },
      ]),
      null
    );
  });
});
