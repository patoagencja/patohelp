"use client";

import { useState } from "react";
import {
  ArrowRight,
  BellRing,
  Loader2,
  MailCheck,
  RotateCw,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sky } from "@/components/ui/sky";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { useZenMode, ZenControls, ZenScene } from "./zen-mode";

// Supabase returns English errors; a client stuck on "Email rate limit
// exceeded" at the front door is the worst first impression we can make.
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes"))
    return "Link został już wysłany przed chwilą. Sprawdź skrzynkę (także Spam) albo spróbuj za minutę.";
  if (m.includes("invalid") && m.includes("email"))
    return "Ten adres e-mail wygląda na niepoprawny - sprawdź literówki.";
  if (m.includes("signups not allowed") || m.includes("not found") || m.includes("not authorized"))
    return "Ten adres nie ma jeszcze dostępu do panelu. Napisz do opiekuna w Pato - doda go w minutę.";
  return "Nie udało się wysłać linku. Spróbuj ponownie za chwilę.";
}

const BENEFITS = [
  { icon: TrendingUp, text: "Wyniki Meta, Google i strony w jednym miejscu - na żywo" },
  { icon: Sparkles, text: "Najważniejsze wnioski opisane po ludzku, bez żargonu" },
  { icon: Trophy, text: "Rekordy i sukcesy gotowe do pokazania zarządowi" },
  { icon: BellRing, text: "Alert, zanim mały problem zrobi się duży" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const zenMode = useZenMode();
  // "Wyślij ponownie" on the sent card: its own state, so the card stays put
  // while the second link goes out.
  const [resend, setResend] = useState<{ state: "idle" | "sending" | "done"; error: string | null }>({
    state: "idle",
    error: null,
  });

  // The one magic-link request; the form and "Wyślij ponownie" both use it.
  async function requestLink(): Promise<string | null> {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    return error ? friendlyError(error.message) : null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const error = await requestLink();

    if (error) {
      setErrorMessage(error);
      setStatus("error");
      return;
    }

    setResend({ state: "idle", error: null });
    setStatus("sent");
  }

  async function handleResend() {
    setResend({ state: "sending", error: null });
    const error = await requestLink();
    setResend({ state: "done", error });
  }

  return (
    // Logowanie board in the 2026 pastel system: the drifting sky, one
    // frosted card with the single field (or "check your inbox"), and a
    // quieter card with what the client gets.
    <main data-zen={zenMode.zen || undefined} className="relative isolate flex min-h-screen flex-col items-center justify-center gap-7 overflow-hidden bg-background px-4 pb-12 pt-20 sm:px-6">
      {zenMode.zen ? <ZenScene /> : <Sky />}
      <ZenControls
        zen={zenMode.zen}
        muted={zenMode.muted}
        onToggleZen={zenMode.toggleZen}
        onToggleMuted={zenMode.toggleMuted}
      />

      {zenMode.zen ? (
        <p className="animate-rise text-center text-[15px] font-medium tracking-[-0.01em] text-white/85 [text-shadow:0_1px_12px_rgba(0,0,0,.35)]">
          Wdech… wydech… Twoje kampanie pracują.
        </p>
      ) : null}

      <div className="flex w-full max-w-[59rem] flex-wrap items-stretch justify-center gap-6">
        <section className="glass flex min-w-0 max-w-[27.5rem] flex-[1_1_21rem] flex-col gap-7 rounded-glass p-7 animate-rise sm:p-10">
          <div className="flex items-center gap-3">
            {/* Brand mark in the "selected" language: the ink tile with the
                lime dot of the active nav pill. */}
            <span className="relative flex h-10 w-10 items-center justify-center rounded-[14px] bg-anchor text-anchor-foreground">
              <Sparkles className="h-[18px] w-[18px]" aria-hidden />
              <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-anchor-dot" />
            </span>
            <p className="text-[15px] font-semibold tracking-[-0.02em]">Kaleido</p>
          </div>

          {status === "sent" ? (
            <div role="status" className="flex flex-col items-start gap-5 animate-rise">
              <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-lime-soft text-positive">
                <MailCheck className="h-6 w-6" aria-hidden />
              </span>
              <div>
                <h1 className="text-[28px] font-medium leading-tight tracking-[-0.035em]">Sprawdź skrzynkę</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2 [text-wrap:pretty]">
                  Wysłaliśmy link do logowania na{" "}
                  <strong className="break-all font-medium text-foreground">{email}</strong>. Kliknij go na
                  tym urządzeniu - otworzy panel od razu, bez hasła. Link działa przez godzinę i tylko raz.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="chip"
                  size="pill"
                  onClick={handleResend}
                  disabled={resend.state === "sending"}
                >
                  {resend.state === "sending" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <RotateCw aria-hidden />
                  )}
                  Wyślij ponownie
                </Button>
                <Button type="button" variant="ghost" size="pill" onClick={() => setStatus("idle")}>
                  Zmień adres
                </Button>
              </div>
              <p aria-live="polite" className="text-sm empty:hidden">
                {resend.state === "done" ? (
                  resend.error ? (
                    <span className="text-negative">{resend.error}</span>
                  ) : (
                    <span className="text-positive">Wysłaliśmy nowy link - poprzedni już nie zadziała.</span>
                  )
                ) : null}
              </p>
              <p className="text-[13px] leading-relaxed text-ink-3">
                Nie widzisz wiadomości? Zajrzyj do folderu Oferty lub Spam.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-[2rem] font-medium leading-[1.1] tracking-[-0.04em]">Zaloguj się do panelu</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                  Wpisz swój e-mail - wyślemy Ci link do logowania. Bez hasła.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Adres e-mail
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="imie@firma.pl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={status === "sending"}
                    aria-invalid={status === "error" || undefined}
                    aria-describedby={errorMessage ? "login-error" : undefined}
                    className="h-[52px] rounded-2xl border-line bg-chip px-4 text-base hover:bg-[var(--chip-hover)] focus-visible:border-foreground/50 focus-visible:bg-card focus-visible:ring-4 focus-visible:ring-lime/45 dark:focus-visible:bg-chip aria-[invalid=true]:border-negative"
                  />
                </div>

                {errorMessage ? (
                  <p
                    id="login-error"
                    role="alert"
                    className="rounded-2xl bg-negative-soft px-4 py-3 text-sm leading-relaxed text-negative"
                  >
                    {errorMessage}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="h-[52px] w-full text-base active:scale-[.98] motion-reduce:active:scale-100"
                  disabled={status === "sending"}
                >
                  {status === "sending" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      Wysyłam link…
                    </>
                  ) : (
                    <>
                      Wyślij link do logowania
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>

              <p className="text-[13px] leading-relaxed text-ink-3">
                Nie masz dostępu? Napisz do swojego opiekuna w Pato - doda Cię w kilka minut.
              </p>
            </>
          )}
        </section>

        {/* What the client gets, before they even log in. */}
        <section
          aria-labelledby="login-benefits"
          className="glass flex min-w-0 max-w-[27.5rem] flex-[1_1_21rem] flex-col gap-6 rounded-glass p-7 animate-rise [--d:.15s] sm:p-10"
        >
          <div>
            <p className="kick">Co znajdziesz w panelu</p>
            <h2 id="login-benefits" className="mt-2 text-[22px] font-medium leading-snug tracking-[-0.03em]">
              Twoje reklamy i strona w jednym, spokojnym widoku
            </h2>
          </div>
          <ul className="flex flex-col">
            {BENEFITS.map((b) => (
              <li
                key={b.text}
                className="flex items-center gap-3.5 border-t border-line py-3.5 text-[15px] leading-snug text-ink-2 first:border-t-0 first:pt-0"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-lime-soft text-positive">
                  <b.icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className={cn("text-[13px]", zenMode.zen ? "text-white/75" : "text-ink-3")}>
        Panel raportowy · Pato Agencja
      </p>
    </main>
  );
}
