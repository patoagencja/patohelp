"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      };
      if (body.still_running) {
        toast.success(
          "Odświeżanie trwa w tle - duże konto dociąga historię, dane wpadają partiami.",
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
    >
      <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
      {loading ? "Odświeżam…" : "Odśwież"}
    </Button>
  );
}
