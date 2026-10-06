"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Two-step submit for revoking access: the first click only arms it, so a
 * stray click in a list of people can't lock a client out of their panel.
 * Disarms itself after a few seconds.
 */
export function AccessRemoveButton({ label }: { label: string }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  // Distinct keys so React swaps the elements instead of flipping `type` on
  // the button that is mid-click (which could submit on the first click).
  return armed ? (
    <Button
      key="confirm"
      type="submit"
      variant="destructive"
      size="pill"
      autoFocus
    >
      Na pewno?
    </Button>
  ) : (
    <Button
      key="arm"
      type="button"
      variant="ghost"
      size="pill"
      className="text-destructive hover:bg-negative-soft hover:text-destructive"
      onClick={() => setArmed(true)}
    >
      {label}
    </Button>
  );
}
