"use client";

import { useFormState, useFormStatus } from "react-dom";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CopyTextButton } from "./copy-text-button";
import { createShareLink, type CreateShareLinkState } from "./share-link-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="pill" variant="outline" disabled={pending} className="gap-1.5">
      <KeyRound className="h-4 w-4" aria-hidden />
      {pending ? "Tworzę…" : "Utwórz link z hasłem"}
    </Button>
  );
}

export function ShareLinkCreator({ clientSlug }: { clientSlug: string }) {
  const [state, action] = useFormState<CreateShareLinkState, FormData>(createShareLink, {
    status: "idle",
  });

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="client" value={clientSlug} />
        <SubmitButton />
      </form>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-negative">
          {state.message}
        </p>
      ) : null}

      {state.status === "created" ? (
        <div role="status" className="flex flex-col gap-3 rounded-[16px] bg-positive-soft px-4 py-3 text-sm">
          <p className="font-medium">
            Gotowe. Hasło widzisz tylko teraz - skopiuj je i wyślij klientowi osobno (np. SMS-em).
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Link</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[10px] bg-card px-2 py-1 text-xs">{state.link}</code>
              <CopyTextButton text={state.link} label="Kopiuj link" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Hasło</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-[10px] bg-card px-2 py-1 font-mono text-base tracking-wider">{state.password}</code>
              <CopyTextButton text={state.password} label="Kopiuj hasło" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
