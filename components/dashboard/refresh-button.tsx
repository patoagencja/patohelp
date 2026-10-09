"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const labels = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s !== "") : [];

export function RefreshButton({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    toast.loading("Odświeżam dane…", { id: "refresh" });
    try {
      const res = await fetch(`/api/sync/run?client=${clientSlug}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      const body = (await res.json().catch(() => ({}))) as {
        still_running?: boolean;
        failed?: unknown;
        deferred?: unknown;
      };
      // The route answers 200 whatever each source did; "Dane odświeżone"
      // over a failed Meta pull read as fresh numbers that weren't.
      const failed = labels(body.failed);
      const deferred = labels(body.deferred);
      if (failed.length) {
        toast.warning(`Odświeżono, ale nie udało się pobrać: ${failed.join(", ")}`, {
          id: "refresh",
          duration: 8000,
        });
      } else if (body.still_running) {
        toast.success(
          "Odświeżanie trwa w tle - przy dużym koncie historię pobieramy partiami, więc dane będą pojawiać się stopniowo.",
          { id: "refresh", duration: 6000 }
        );
      } else if (deferred.length) {
        toast.success(
          `Dane odświeżone. Resztę (${deferred.join(", ")}) dociągniemy przy najbliższej synchronizacji (do 30 min).`,
          { id: "refresh", duration: 6000 }
        );
      } else {
        toast.success("Dane odświeżone", { id: "refresh" });
      }
      router.refresh();
    } catch {
      toast.error("Nie udało się odświeżyć", { id: "refresh" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={refresh}
      disabled={loading}
      className="gap-1.5"
      aria-label={loading ? "Odświeżam dane" : "Odśwież dane"}
      title="Odśwież dane"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
      <span className="sr-only">{loading ? "Odświeżam…" : "Odśwież"}</span>
    </Button>
  );
}
