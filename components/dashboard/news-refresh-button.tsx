"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/** News refresh with visible outcome - surfaces the exact server error. */
export function NewsRefreshButton({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    toast.loading("Szukam świeżych newsów (ok. 1 min)…", { id: "news" });
    try {
      // Hard client-side cap: if the serverless function is killed mid-flight
      // the response never arrives, and without this the spinner hangs forever.
      const res = await fetch(`/api/news/refresh?client=${clientSlug}`, {
        method: "POST",
        signal: AbortSignal.timeout(150_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        category?: string;
        remaining?: string[];
        error?: string;
      };
      if (body.ok) {
        const left = body.remaining?.length
          ? ` Zostało: ${body.remaining.join(", ")} - kliknij ponownie.`
          : "";
        toast.success(
          `Pobrano ${body.count} newsów (${body.category}).${left}`,
          { id: "news", duration: 8000 }
        );
        router.refresh();
      } else {
        toast.error(body.error ?? `Błąd ${res.status}`, {
          id: "news",
          duration: 15000,
        });
      }
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      toast.error(
        timedOut
          ? "Research trwał za długo i został przerwany. Spróbuj ponownie - cron też dobija newsy co 30 min."
          : "Nie udało się połączyć z serwerem.",
        { id: "news", duration: 10000 }
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={loading}
      title="Pobierz świeże newsy teraz"
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
    </button>
  );
}
