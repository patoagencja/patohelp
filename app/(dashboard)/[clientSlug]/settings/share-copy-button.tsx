"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Copies the share URL; resolves a relative path against the current origin
 *  when NEXT_PUBLIC_APP_URL isn't configured. */
export function ShareCopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const absolute = new URL(url, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (non-secure context, permissions) - fall back
      // to a prompt the user can copy from by hand.
      window.prompt("Skopiuj link:", absolute);
    }
  }

  return (
    <Button type="button" variant="outline" size="pill" onClick={copy} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Skopiowano" : "Kopiuj"}
    </Button>
  );
}
