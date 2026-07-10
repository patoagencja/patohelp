"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TestAlertButton({ clientSlug }: { clientSlug: string }) {
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    toast.loading("Wysyłam test…", { id: "test-alert" });
    try {
      const res = await fetch(`/api/notify/test?client=${clientSlug}`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "");
      toast.success("Wysłano testowy alert", { id: "test-alert" });
    } catch (e) {
      toast.error(
        e instanceof Error && e.message ? e.message : "Nie udało się wysłać",
        { id: "test-alert" }
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={send}
      disabled={loading}
      className="gap-1.5"
    >
      <Send className={cn("h-4 w-4", loading && "animate-pulse")} />
      {loading ? "Wysyłam…" : "Wyślij testowy alert"}
    </Button>
  );
}
