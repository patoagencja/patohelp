"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Copies a literal string (e.g. the service account email to paste in GA4). */
export function CopyTextButton({ text, label = "Kopiuj" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked - let the user copy it by hand.
      window.prompt("Skopiuj:", text);
    }
  }

  return (
    <Button type="button" variant="outline" size="pill" onClick={copy} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Skopiowano" : label}
    </Button>
  );
}
