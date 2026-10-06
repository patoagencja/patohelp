"use client";

import { useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Loader2,
  MailCheck,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErrorMessage(friendlyError(error.message));
      setStatus("error");
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel - what the client gets, before they even log in. */}
      {/* Brand panel: complementary, so its slogan is not a heading - the
          page's only h1 is the form's "Zaloguj się". */}
      <aside
        aria-label="O panelu Pato"
        className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col lg:justify-between"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5 text-lg font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          Pato
        </div>

        <div className="relative max-w-md">
          <p className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            Twoje wyniki marketingu. Jasno, w jednym miejscu.
          </p>
          <ul className="mt-8 space-y-4">
            {BENEFITS.map((b) => (
              <li key={b.text} className="flex items-start gap-3 text-indigo-50">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <b.icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="text-[15px] leading-relaxed">{b.text}</span>
              </li>
            ))}
          </ul>

          {/* A taste of the dashboard's tone - illustrative, not real data. */}
          <div className="mt-10 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
              Najważniejsze w skrócie
            </p>
            <p className="mt-2 text-lg font-medium leading-snug">
              Reklamy przyciągnęły o 16% więcej osób niż miesiąc wcześniej.
            </p>
            <div className="mt-4 flex gap-6">
              <div>
                <p className="text-2xl font-bold tabular-nums">2,2 mln</p>
                <p className="text-xs text-indigo-200">wyświetleń reklam</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">0,95 zł</p>
                <p className="text-xs text-indigo-200">za jedno kliknięcie</p>
              </div>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-indigo-200">Panel klienta agencji Pato</p>
      </aside>

      {/* Form */}
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-lg font-semibold lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            Pato
          </div>

          {status === "sent" ? (
            <div role="status" className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <MailCheck className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">Sprawdź skrzynkę</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Wysłaliśmy link do logowania na <strong className="text-foreground">{email}</strong>.
                Kliknij go na tym urządzeniu - otworzy panel od razu, bez hasła.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  Nie widzisz maila? Zajrzyj do folderu Spam lub Oferty.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  Link działa przez godzinę i tylko raz.
                </li>
              </ul>
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="mt-8 text-sm font-medium text-primary dark:text-indigo-300 hover:underline"
              >
                Użyj innego adresu
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Zaloguj się</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Bez hasła - podaj swój e-mail, a wyślemy Ci link, który od razu
                otworzy panel.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Adres e-mail</Label>
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
                    className="h-11"
                  />
                </div>

                {errorMessage ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {errorMessage}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  className="h-11 w-full gap-2 text-[15px]"
                  disabled={status === "sending"}
                >
                  {status === "sending" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
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

              <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
                Nie masz dostępu? Napisz do swojego opiekuna w Pato - dodamy Cię
                w kilka minut.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
