"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Provider slug matches the route folder: "meta" | "google-ads" | "tiktok".
export function TestConnectionButton({
  provider,
  clientSlug,
}: {
  provider: "meta" | "google-ads" | "ga4" | "tiktok";
  clientSlug: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleTest() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/integrations/${provider}/test?client=${clientSlug}`,
        { method: "POST" }
      );
      const data = await res.json();

      if (data.ok) {
        const sample = data.sample?.length ? ` (${data.sample.join(", ")})` : "";
        toast.success(`Pobrano ${data.accounts_count} kont${sample}`);
      } else {
        toast.error(data.error ?? "Test nie powiódł się");
      }
    } catch {
      toast.error("Błąd sieci podczas testu połączenia");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleTest} disabled={loading}>
      {loading ? "Testuję…" : "Test"}
    </Button>
  );
}
