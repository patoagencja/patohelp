import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitCsv } from "../shop/parse.ts";
import {
  CSV_BOM,
  buildCsv,
  csvFileName,
  escapeCsvField,
  formatCsvValue,
  type CsvColumn,
} from "./csv.ts";

const CAMPAIGN_COLUMNS: CsvColumn[] = [
  { header: "Kampania", kind: "text" },
  { header: "Wydatki", kind: "money" },
  { header: "Kliknięcia", kind: "int" },
  { header: "Klikalność", kind: "percent" },
];

/** The file read back the way Excel would split it (BOM and CRLF off). */
function readBack(csv: string): string[][] {
  assert.ok(csv.startsWith(CSV_BOM), "starts with the UTF-8 BOM");
  return splitCsv(csv.slice(CSV_BOM.length), ";").map((r) => r.cells);
}

describe("buildCsv", () => {
  it("writes BOM, header row in column order and CRLF line ends", () => {
    const csv = buildCsv(CAMPAIGN_COLUMNS, [["Drzwi wejściowe", 1234567, 812, 2.4]]);
    assert.equal(
      csv,
      `${CSV_BOM}Kampania;Wydatki;Kliknięcia;Klikalność\r\nDrzwi wejściowe;12345,67;812;2,40\r\n`
    );
  });

  it("keeps Polish characters as they are", () => {
    const rows = readBack(
      buildCsv(CAMPAIGN_COLUMNS, [["Zażółć gęślą jaźń - Łódź, Kraków", 100, 1, 1]])
    );
    assert.deepEqual(rows[0], ["Kampania", "Wydatki", "Kliknięcia", "Klikalność"]);
    assert.equal(rows[1][0], "Zażółć gęślą jaźń - Łódź, Kraków");
  });

  it("quotes names with semicolons, quotes and line breaks so columns stay put", () => {
    const names = [
      "DRE; jesień 2026",
      'Drzwi "Premium" 80 cm',
      "Remarketing\nlinia 2",
      "Windows\r\nlinia",
    ];
    const csv = buildCsv(
      CAMPAIGN_COLUMNS,
      names.map((n) => [n, 100, 1, 1])
    );
    assert.ok(csv.includes('"DRE; jesień 2026";1,00'));
    assert.ok(csv.includes('"Drzwi ""Premium"" 80 cm";1,00'));
    const rows = readBack(csv);
    assert.equal(rows.length, names.length + 1);
    names.forEach((n, i) => {
      assert.equal(rows[i + 1].length, CAMPAIGN_COLUMNS.length);
      assert.equal(rows[i + 1][0], n);
      assert.equal(rows[i + 1][1], "1,00");
    });
  });

  it("writes negative numbers with a plain minus and a decimal comma", () => {
    const columns: CsvColumn[] = [
      { header: "Zwrot", kind: "money" },
      { header: "Zmiana", kind: "percent", digits: 0 },
      { header: "Różnica", kind: "int" },
      { header: "Częst.", kind: "decimal", digits: 1 },
    ];
    const rows = readBack(buildCsv(columns, [[-150, -12.6, -3, -1.25]]));
    assert.deepEqual(rows[1], ["-1,50", "-13", "-3", "-1,3"]);
  });

  it("gives an empty table just its header row", () => {
    assert.equal(buildCsv(CAMPAIGN_COLUMNS, []), `${CSV_BOM}Kampania;Wydatki;Kliknięcia;Klikalność\r\n`);
    assert.equal(buildCsv([], []), `${CSV_BOM}\r\n`);
  });

  it("leaves missing values empty instead of writing '-' or 0", () => {
    const columns: CsvColumn[] = [
      { header: "Koszt kliknięcia", kind: "money" },
      { header: "Klikalność", kind: "percent" },
      { header: "Reklama", kind: "text" },
    ];
    const rows = readBack(buildCsv(columns, [[null, undefined, null], [Number.NaN, "", undefined]]));
    assert.deepEqual(rows[1], ["", "", ""]);
    assert.deepEqual(rows[2], ["", "", ""]);
  });
});

describe("formatCsvValue", () => {
  const money: CsvColumn = { header: "", kind: "money" };
  const pct: CsvColumn = { header: "", kind: "percent" };

  it("turns grosze into złoty with two decimals and no grouping", () => {
    assert.equal(formatCsvValue(0, money), "0,00");
    assert.equal(formatCsvValue(5, money), "0,05");
    assert.equal(formatCsvValue(-5, money), "-0,05");
    assert.equal(formatCsvValue(123456789, money), "1234567,89");
    // Fractional grosze (an average CPC) round to whole grosze.
    assert.equal(formatCsvValue(95.6, money), "0,96");
    // bigint columns can arrive as strings from PostgREST.
    assert.equal(formatCsvValue("43909", money), "439,09");
  });

  it("never writes a minus on a value that rounds to zero", () => {
    assert.equal(formatCsvValue(-0.4, money), "0,00");
    assert.equal(formatCsvValue(-0.001, pct), "0,00");
    assert.equal(formatCsvValue(-0.4, { header: "", kind: "int" }), "0");
  });

  it("keeps percentages as numbers in percent units", () => {
    assert.equal(formatCsvValue(2.4, pct), "2,40");
    assert.equal(formatCsvValue(100, { header: "", kind: "percent", digits: 0 }), "100");
    assert.equal(formatCsvValue(31.6, { header: "", kind: "percent", digits: 0 }), "32");
  });

  it("writes days as yyyy-MM-dd and anything else as text", () => {
    const date: CsvColumn = { header: "", kind: "date" };
    assert.equal(formatCsvValue("2026-11-07", date), "2026-11-07");
    assert.equal(formatCsvValue("7 lis 2026", date), "7 lis 2026");
    assert.equal(formatCsvValue(null, date), "");
  });

  it("keeps text that Excel would read as a formula as text", () => {
    const text: CsvColumn = { header: "", kind: "text" };
    assert.equal(formatCsvValue("-30% na drzwi", text), "'-30% na drzwi");
    assert.equal(formatCsvValue("=HYPERLINK(\"x\")", text), "'=HYPERLINK(\"x\")");
    assert.equal(formatCsvValue("+48 promo", text), "'+48 promo");
    assert.equal(formatCsvValue("@kampania", text), "'@kampania");
    assert.equal(formatCsvValue("/blog/poradnik-montazu", text), "/blog/poradnik-montazu");
    assert.equal(formatCsvValue("Drzwi - lato", text), "Drzwi - lato");
  });
});

describe("escapeCsvField", () => {
  it("leaves plain text and decimal commas alone", () => {
    assert.equal(escapeCsvField("Drzwi wewnętrzne"), "Drzwi wewnętrzne");
    assert.equal(escapeCsvField("12,50"), "12,50");
  });

  it("doubles quotes inside a quoted field", () => {
    assert.equal(escapeCsvField('a "b" c'), '"a ""b"" c"');
    assert.equal(escapeCsvField("a;b"), '"a;b"');
    assert.equal(escapeCsvField("a\nb"), '"a\nb"');
  });
});

describe("csvFileName", () => {
  it("names the client, the table and the window", () => {
    assert.equal(
      csvFileName({ client: "dre", from: "2026-10-01", to: "2026-10-31" }, "kampanie"),
      "kaleido-dre-kampanie-2026-10-01_2026-10-31.csv"
    );
  });

  it("strips Polish letters and odd characters from the parts", () => {
    assert.equal(
      csvFileName({ client: "Łódź Okna", from: "2026-10-01", to: "2026-10-31" }, "Kampanie - szczegóły"),
      "kaleido-lodz-okna-kampanie-szczegoly-2026-10-01_2026-10-31.csv"
    );
  });

  it("drops the window when a day is missing or malformed", () => {
    assert.equal(csvFileName({ client: "dre", from: null, to: "2026-10-31" }, "kreacje"), "kaleido-dre-kreacje.csv");
    assert.equal(
      csvFileName({ client: "dre", from: "1 paź", to: "2026-10-31" }, "kreacje"),
      "kaleido-dre-kreacje.csv"
    );
  });
});
