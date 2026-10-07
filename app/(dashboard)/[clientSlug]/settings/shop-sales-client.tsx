"use client";

import { useState, useTransition, type FormEvent } from "react";
import { FileUp, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { CopyTextButton } from "./copy-text-button";
import {
  disableShopIngestKey,
  generateShopIngestKey,
  uploadShopSalesCsv,
} from "./shop-sales-actions";

// Mirrors MAX_CSV_BYTES in shop-sales-actions.ts: refusing here saves the
// upload, and Vercel's own 413 page for a >4.5 MB body would be cryptic.
const MAX_CSV_BYTES = 4 * 1024 * 1024;

/**
 * The shop's API key: generate / replace / disable. The full key comes back
 * from the Server Action into this component's state only - shown once, never
 * put in a URL or cookie, gone on reload (only the prefix is stored).
 */
export function ShopSalesKey({
  clientSlug,
  keyPrefix,
  createdAtLabel,
}: {
  clientSlug: string;
  /** e.g. "kal_live_AbCd"; null when the client has no key. */
  keyPrefix: string | null;
  /** Creation time, already formatted in Warsaw time by the server. */
  createdAtLabel: string | null;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"generate" | "disable" | null>(null);

  function generate() {
    if (
      keyPrefix &&
      !window.confirm(
        "Nowy klucz od razu zastąpi obecny - sklep dostanie błąd 401, dopóki programista nie wklei nowego. Kontynuować?"
      )
    ) {
      return;
    }
    setAction("generate");
    startTransition(async () => {
      const res = await generateShopIngestKey({ clientSlug });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRevealed(res.key);
      toast.success("Klucz wygenerowany - skopiuj go teraz.");
    });
  }

  function disable() {
    if (!window.confirm("Wyłączyć klucz? Sklep przestanie przesyłać sprzedaż (dane już wysłane zostają).")) {
      return;
    }
    setAction("disable");
    startTransition(async () => {
      const res = await disableShopIngestKey({ clientSlug });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRevealed(null);
      toast.success("Klucz wyłączony.");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {revealed ? (
        <div className="flex flex-col gap-2 rounded-[20px] bg-warning-soft/70 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            Skopiuj klucz teraz - po odświeżeniu strony zobaczysz już tylko jego początek.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={revealed}
              aria-label="Klucz API sklepu"
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 min-w-0 flex-1 rounded-full border border-transparent bg-card px-4 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <CopyTextButton text={revealed} label="Kopiuj klucz" />
          </div>
          <p className="text-xs text-muted-foreground">
            Przekaż go programiście sklepu bezpiecznym kanałem (nie w otwartym wątku czy mailu do wielu osób).
          </p>
        </div>
      ) : null}

      {keyPrefix ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground">
          <KeyRound className="h-4 w-4 shrink-0 text-positive" aria-hidden />
          Klucz aktywny:
          <code className="rounded bg-muted px-1.5 font-mono text-xs">{keyPrefix}…</code>
          {createdAtLabel ? (
            <span className="text-xs text-muted-foreground">utworzony {createdAtLabel}</span>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Brak klucza - sklep nie może jeszcze wysyłać sprzedaży.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="pill" onClick={generate} disabled={pending} className="w-fit">
          {pending && action === "generate" ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {keyPrefix ? "Wygeneruj nowy klucz" : "Wygeneruj klucz API"}
        </Button>
        {keyPrefix ? (
          <Button
            type="button"
            variant="ghost"
            size="pill"
            onClick={disable}
            disabled={pending}
            className="text-destructive hover:bg-negative-soft hover:text-destructive"
          >
            {pending && action === "disable" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Wyłącz klucz
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * CSV history upload. Submits through a transition instead of a bare form
 * action so the button can show progress (a season file takes a few
 * seconds); the action returns the result for the toast.
 */
export function ShopCsvUpload({ clientSlug }: { clientSlug: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      toast.error("Wybierz plik CSV.");
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      toast.error("Plik jest za duży (maks. 4 MB). Podziel go na kilka części, np. po sezonach.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await uploadShopSalesCsv(form);
        if (!res.ok) {
          toast.error(res.error, { duration: 15000 });
          return;
        }
        toast.success(`Wczytano sprzedaż z CSV: ${res.rows} ${res.rows === 1 ? "wiersz" : "wierszy"}.`);
        router.refresh();
      } catch {
        // Transport failures only (network, body limit).
        toast.error("Nie udało się wysłać pliku. Spróbuj ponownie.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="client" value={clientSlug} />
      <input
        type="file"
        name="file"
        required
        accept=".csv,.txt,text/csv,text/plain"
        aria-label="Plik CSV ze sprzedażą"
        className="min-w-0 max-w-full text-sm text-ink-2 file:mr-3 file:h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-chip file:px-[18px] file:text-[15px] file:font-medium file:text-foreground hover:file:bg-[var(--chip-hover)]"
      />
      <Button type="submit" size="pill" disabled={pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
        {pending ? "Wczytuję…" : "Wczytaj CSV"}
      </Button>
    </form>
  );
}
