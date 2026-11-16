"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { restoreDemoSampleData, snapshotDemoProfile } from "./demo-actions";

/** The Demo card's two buttons (admins only - the actions check it again). */
export function DemoButtons({
  clientSlug,
  hasProfile,
  usedElsewhere,
}: {
  clientSlug: string;
  /** The demo shows a client's numbers now (this one or another). */
  hasProfile: boolean;
  /** ...and they are another client's. */
  usedElsewhere: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (action: typeof snapshotDemoProfile) =>
    startTransition(async () => {
      const res = await action({ clientSlug });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="pill"
        disabled={pending}
        onClick={() => {
          if (usedElsewhere && !window.confirm("Demo pokazuje teraz liczby innego klienta. Zastąpić je liczbami tego klienta?")) return;
          run(snapshotDemoProfile);
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Użyj liczb tego klienta w demo
      </Button>
      {hasProfile ? (
        <Button type="button" size="pill" variant="ghost" disabled={pending} onClick={() => run(restoreDemoSampleData)}>
          Przywróć przykładowe dane
        </Button>
      ) : null}
    </div>
  );
}
