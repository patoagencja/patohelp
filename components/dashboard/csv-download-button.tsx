"use client";

import { Download } from "lucide-react";

import { buildCsv, type CsvColumn, type CsvValue } from "@/lib/export/csv";
import { cn } from "@/lib/utils";

/**
 * "Pobierz do Excela": saves the rows a table shows as a CSV, built in the
 * browser from data the page already has - no server round trip, no API
 * call. Rows are plain values in column order, so server components can
 * hand them over as props too.
 */
export function CsvDownloadButton({
  columns,
  rows,
  fileName,
  lang = "pl",
  className,
}: {
  columns: CsvColumn[];
  rows: CsvValue[][];
  fileName: string;
  lang?: "pl" | "en";
  className?: string;
}) {
  const label = lang === "en" ? "Download table for Excel" : "Pobierz tabelę do Excela";

  function download() {
    const blob = new Blob([buildCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Some browsers read the blob after click() returns; revoking at once
    // can cancel the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <button
      type="button"
      onClick={download}
      aria-label={label}
      title={label}
      data-print-hide
      data-present-hide
      // Quiet chip like the card's other controls; 44px everywhere. The word
      // hides on phones, leaving a round icon button.
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-chip px-3 text-sm font-medium text-ink-2 transition-[background-color,color,transform] duration-200 hover:bg-[var(--chip-hover)] hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100 sm:px-4",
        className
      )}
    >
      <Download className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Excel</span>
    </button>
  );
}
