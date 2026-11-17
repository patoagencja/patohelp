"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { CHANNEL_LABEL, dayDot, MANUAL_CHANNELS, weekdayPl } from "@/lib/daily-net/calc";
import {
  cellKey,
  diffManualCells,
  formatAmountInput,
  isBlock,
  type ManualChange,
  parseAmount,
  type PasteUnit,
  planPaste,
  splitPastedBlock,
} from "@/lib/daily-net/paste";
import { cn, formatPlnWhole } from "@/lib/utils";

export type ManualSaveResult = { ok: true; saved: number; deleted: number } | { ok: false; error: string };

const CHANNELS = MANUAL_CHANNELS;

/** Polish count noun: 1 pole, 2-4 pola, 5+ pól (12-14 pól, 22-24 pola). */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const tens = n % 100;
  return n % 10 >= 2 && n % 10 <= 4 && (tens < 12 || tens > 14) ? few : many;
}

/**
 * "Koszty spoza integracji": days x channels, amounts in złoty, like the
 * shop's own sheet. A block copied from Google Sheets or Excel pasted into
 * any cell fills down the days and right across the channels; the unit
 * switch says whether pasted numbers are złoty or thousands (their sheet
 * is in thousands). Typing is always złoty. One Save sends every changed
 * cell; an empty or zero cell deletes that day's entry.
 */
export function ManualCostsGrid({
  clientSlug,
  dates,
  stored,
  tiktokApiDates,
  save,
  readOnlyNote,
}: {
  clientSlug: string;
  /** Rows of the grid, oldest first (the page's range). */
  dates: string[];
  /** What is saved now: cellKey(date, channel) -> grosze. */
  stored: Record<string, number>;
  /** Days the TikTok integration has data for: a typed TikTok cost there doesn't count. */
  tiktokApiDates: string[];
  /** The bulk-save Server Action; absent = read-only (the demo). */
  save?: (payload: { client: string; changes: ManualChange[] }) => Promise<ManualSaveResult>;
  readOnlyNote?: string;
}) {
  const router = useRouter();
  const readOnly = !save;
  const boxRef = useRef<HTMLDivElement>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<PasteUnit>("zl");
  const [note, setNote] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const tiktokApi = useMemo(() => new Set(tiktokApiDates), [tiktokApiDates]);

  // Edits stay on screen until the saved numbers come back from the server
  // (a refresh with a different `stored`), so nothing flickers back to the
  // old value in between. An unrelated refresh (the live sync poll) keeps
  // unsaved edits.
  const storedSig = useMemo(() => JSON.stringify(stored), [stored]);
  const [clearOnSig, setClearOnSig] = useState<string | null>(null);
  useEffect(() => {
    if (clearOnSig !== null && storedSig !== clearOnSig) {
      setEdits({});
      setClearOnSig(null);
    }
  }, [storedSig, clearOnSig]);

  const text = (key: string) => (key in edits ? edits[key] : formatAmountInput(stored[key] ?? null));
  const { changes, invalid } = useMemo(() => diffManualCells(stored, edits), [stored, edits]);
  const invalidSet = useMemo(() => new Set(invalid), [invalid]);
  const dirty = changes.length + invalid.length;

  useEffect(() => {
    if (!dirty || clearOnSig !== null) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, clearOnSig]);

  // What counts: a TikTok entry on a day the integration covers doesn't (the table above ignores it too).
  const amount = (date: string, channel: string) =>
    channel === "tiktok" && tiktokApi.has(date) ? 0 : parseAmount(text(cellKey(date, channel)), "zl") ?? 0;
  const colTotals = CHANNELS.map((c) => dates.reduce((a, d) => a + amount(d, c), 0));

  function setCell(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  function focusCell(row: number, col: number) {
    const el = boxRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${row}-${col}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(Math.min(dates.length - 1, row + 1), col);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(Math.max(0, row - 1), col);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, row: number, col: number) {
    const raw = e.clipboardData.getData("text/plain");
    // A single value in złoty pastes like plain typing.
    if (!isBlock(raw) && unit === "zl") return;
    e.preventDefault();
    const plan = planPaste(splitPastedBlock(raw), row, col, dates.length, CHANNELS.length, unit);
    setEdits((prev) => {
      const next = { ...prev };
      for (const c of plan.cells) next[cellKey(dates[c.row], CHANNELS[c.col])] = formatAmountInput(c.minor);
      return next;
    });
    const parts = [
      `Wklejono ${plan.cells.length} ${plural(plan.cells.length, "pole", "pola", "pól")}${unit === "tys" ? " (z tysięcy zł)" : ""}`,
    ];
    if (plan.invalid) parts.push(`pominięto ${plan.invalid} - to nie kwoty`);
    if (plan.outside) parts.push(`${plan.outside} poza tabelą (za mało dni lub kanałów)`);
    setNote({ tone: plan.invalid || plan.outside ? "info" : "ok", text: `${parts.join(", ")}. Sprawdź i kliknij „Zapisz”.` });
  }

  function onSave() {
    if (!save) return;
    if (invalid.length) {
      setNote({ tone: "bad", text: `Popraw ${invalid.length} ${plural(invalid.length, "pole", "pola", "pól")} zaznaczone na czerwono - to nie są kwoty.` });
      return;
    }
    if (!changes.length) {
      setNote({ tone: "info", text: "Nie ma nic do zapisania." });
      return;
    }
    startTransition(async () => {
      const res = await save({ client: clientSlug, changes });
      if (!res.ok) {
        setNote({ tone: "bad", text: res.error });
        return;
      }
      const msg = `Zapisano ${res.saved} ${plural(res.saved, "kwotę", "kwoty", "kwot")}${res.deleted ? `, usunięto ${res.deleted}` : ""}.`;
      setNote({ tone: "ok", text: msg });
      toast.success(msg);
      setClearOnSig(storedSig);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-print-hide>
          <div role="radiogroup" aria-label="Wklejone liczby to" className={segmentedTrack}>
            <span className="px-2.5 text-xs text-ink-3">wklejone liczby to:</span>
            {(
              [
                ["zl", "zł"],
                ["tys", "tys. zł"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={unit === key}
                onClick={() => setUnit(key)}
                className={segmentedItem(unit === key, "min-h-10 text-[13px]")}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-3">Skopiuj blok z arkusza (np. kolumny PIN, BING, X, CHAT) i wklej w pierwsze pole - wypełni w dół i w prawo.</p>
        </div>
      ) : readOnlyNote ? (
        <p className="text-sm text-ink-2">{readOnlyNote}</p>
      ) : null}

      <div ref={boxRef} className="overflow-auto overscroll-x-contain rounded-[22px] border border-line bg-card sm:max-h-[60vh]">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm tabular-nums">
          <caption className="sr-only">Koszty reklam spoza integracji, w złotych, dzień po dniu</caption>
          <thead className="sticky top-0 z-[2] bg-card text-xs text-ink-3">
            <tr className="[&>th]:border-b [&>th]:border-line">
              <th scope="col" className="sticky left-0 z-[3] bg-card px-3 py-2.5 text-left font-medium shadow-[1px_0_0_var(--line)]">
                Dzień
              </th>
              {CHANNELS.map((c) => (
                <th key={c} scope="col" className="px-2 py-2.5 text-right font-medium">
                  {CHANNEL_LABEL[c]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Razem
              </th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date, r) => {
              const rowTotal = CHANNELS.reduce((a, c) => a + amount(date, c), 0);
              return (
                <tr key={date} className="[&>td]:border-b [&>td]:border-line [&>th]:border-b [&>th]:border-line">
                  <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-card px-3 py-1.5 text-left font-normal shadow-[1px_0_0_var(--line)]">
                    <span className="text-ink-3">{weekdayPl(date)}</span> {dayDot(date)}
                  </th>
                  {CHANNELS.map((c, col) => {
                    const key = cellKey(date, c);
                    const apiWins = c === "tiktok" && tiktokApi.has(date);
                    const value = text(key);
                    const typed = key in edits ? parseAmount(edits[key], "zl") : null;
                    const changed = key in edits && (typed === undefined || (typed ?? 0) !== (stored[key] ?? 0));
                    return (
                      <td key={c} className="px-1 py-1">
                        <input
                          data-cell={`${r}-${col}`}
                          inputMode="decimal"
                          autoComplete="off"
                          readOnly={readOnly}
                          value={value}
                          placeholder={apiWins ? "z API" : undefined}
                          title={apiWins ? "TikTok ma za ten dzień dane z integracji - wpis ręczny nie jest liczony." : undefined}
                          aria-label={`${CHANNEL_LABEL[c]}, ${weekdayPl(date)} ${dayDot(date)}, zł`}
                          aria-invalid={invalidSet.has(key) || undefined}
                          onChange={(e) => setCell(key, e.target.value)}
                          onPaste={(e) => onPaste(e, r, col)}
                          onKeyDown={(e) => onKeyDown(e, r, col)}
                          onFocus={(e) => e.currentTarget.select()}
                          className={cn(
                            "h-9 w-full min-w-[5.5rem] rounded-lg border border-transparent bg-chip px-2 text-right tabular-nums text-foreground outline-none transition-colors placeholder:text-ink-3 hover:bg-secondary focus:border-hairline focus:bg-card focus:ring-2 focus:ring-ring [@media(pointer:coarse)]:h-11",
                            readOnly && "bg-transparent hover:bg-transparent",
                            changed && "bg-lime-soft",
                            invalidSet.has(key) && "border-negative ring-1 ring-negative",
                            apiWins && value && "text-ink-3 line-through"
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-ink-2">{rowTotal > 0 ? formatPlnWhole(rowTotal) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-[2] bg-card font-semibold [&_td]:border-t [&_td]:border-line [&_th]:border-t [&_th]:border-line">
            <tr>
              <th scope="row" className="sticky left-0 z-[3] bg-card px-3 py-2.5 text-left shadow-[1px_0_0_var(--line)]">
                Razem
              </th>
              {colTotals.map((v, i) => (
                <td key={CHANNELS[i]} className="whitespace-nowrap px-2 py-2.5 text-right">
                  {v > 0 ? formatPlnWhole(v) : "-"}
                </td>
              ))}
              <td className="whitespace-nowrap px-3 py-2.5 text-right">{formatPlnWhole(colTotals.reduce((a, v) => a + v, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3" data-print-hide>
          <Button type="button" onClick={onSave} disabled={pending || dirty === 0} size="pill">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {dirty ? `Zapisz (${dirty} ${plural(dirty, "zmiana", "zmiany", "zmian")})` : "Zapisz"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="chip"
              size="pill"
              disabled={pending}
              onClick={() => {
                setEdits({});
                setNote(null);
              }}
            >
              Cofnij zmiany
            </Button>
          ) : null}
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "text-sm",
              note?.tone === "bad" ? "text-negative" : note?.tone === "ok" ? "text-positive" : "text-ink-2"
            )}
          >
            {note?.text ?? ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
