"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

import { openShareLink, type OpenShareState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="pill" disabled={pending} className="w-full">
      {pending ? "Otwieram…" : "Otwórz panel"}
    </Button>
  );
}

export function SharePasswordForm({ token }: { token: string }) {
  const [state, action] = useFormState<OpenShareState, FormData>(openShareLink, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-ink-2">Hasło</span>
        <span className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="off"
            maxLength={100}
            placeholder="xxxx-xxxx-xxxx"
            className="h-12 w-full rounded-[14px] border border-transparent bg-chip pl-9 pr-3 font-mono text-base tracking-wider transition-[background-color,box-shadow] focus-visible:border-line focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </span>
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-negative">
          {state.error}
        </p>
      ) : null}
      <Submit />
    </form>
  );
}
