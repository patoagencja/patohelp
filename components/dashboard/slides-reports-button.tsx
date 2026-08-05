"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Presentation } from "lucide-react";

// Triggers on-demand generation of every active Slides report for the client
// (previous month). The monthly cron does the same automatically on the 1st.
export function GenerateSlidesButton({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/report/slides?client=${clientSlug}`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setMsg(body.error ?? `Błąd (${res.status})`);
      } else {
        const ok = body.results.filter((r: { ok: boolean }) => r.ok).length;
        const failed = body.results.length - ok;
        setMsg(
          failed
            ? `Gotowe: ${ok}, błędy: ${failed} (szczegóły w tabeli)`
            : `Wygenerowano ${ok} raportów ✅`
        );
        router.refresh();
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Presentation className="h-4 w-4" />
        )}
        {busy ? "Generuję..." : "Generuj raporty (poprz. miesiąc)"}
      </button>
    </div>
  );
}
