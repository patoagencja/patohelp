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
    // One calm column on the grey page: who we are, one field, one button.
    // The benefits stay as a quiet list underneath for first-time visitors.
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-[25rem]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-card">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <p className="mt-4 text-sm font-medium text-muted-foreground">Panel klienta Pato</p>
        </div>

        <section className="rounded-card border border-hairline bg-card p-6 shadow-card sm:p-8">
          {status === "sent" ? (
            <div role="status" className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <MailCheck className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">Sprawdź skrzynkę</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                Wysłaliśmy link do logowania na <strong className="font-medium text-foreground">{email}</strong>.
                Kliknij go na tym urządzeniu - otworzy panel od razu, bez hasła.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  Nie widzisz maila? Zajrzyj do folderu Spam lub Oferty.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  Link działa przez godzinę i tylko raz.
                </li>
              </ul>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStatus("idle")}
                className="mt-8 w-full"
              >
                Użyj innego adresu
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-center text-2xl font-semibold tracking-tight">Zaloguj się</h1>
              <p className="mt-2 text-center text-[15px] leading-relaxed text-muted-foreground">
                Bez hasła. Podaj swój e-mail, a wyślemy link, który od razu otworzy panel.
              </p>

              <form onSubmit={handleSubmit} className="mt-7 space-y-4">
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
                  />
                </div>

                {errorMessage ? (
                  <p
                    role="alert"
                    className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive dark:text-red-300"
                  >
                    {errorMessage}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
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
            </>
          )}
        </section>

        <p className="mt-6 text-center text-sm leading-relaxed text-muted-foreground">
          Nie masz dostępu? Napisz do swojego opiekuna w Pato - dodamy Cię w kilka minut.
        </p>

        {/* What the client gets, before they even log in. Complementary, so
            the page's only h1 stays "Zaloguj się". */}
        <aside aria-label="Co znajdziesz w panelu" className="mt-10 border-t border-border pt-8">
          <ul className="space-y-3">
            {BENEFITS.map((b) => (
              <li key={b.text} className="flex items-start gap-3 text-sm text-muted-foreground">
                <b.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="leading-relaxed">{b.text}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
