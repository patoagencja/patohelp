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
    toast.loading("Szukam świeżych newsów (1-2 min)…", { id: "news" });
    try {
      const res = await fetch(`/api/news/refresh?client=${clientSlug}`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        error?: string;
      };
      if (body.ok) {
        toast.success(`Pobrano ${body.count} newsów`, { id: "news" });
        router.refresh();
      } else {
        toast.error(body.error ?? `Błąd ${res.status}`, {
          id: "news",
          duration: 15000,
        });
      }
    } catch {
      toast.error("Nie udało się połączyć z serwerem (timeout?)", {
        id: "news",
        duration: 10000,
      });
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
