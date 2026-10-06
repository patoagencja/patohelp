import { NotFoundCard } from "@/components/dashboard/not-found-card";
import { Sky } from "@/components/ui/sky";

export const metadata = { title: "Nie znaleziono strony - Pato Dashboard" };

// Unknown URLs and expired/invalid share links (/s, /r) land here: the
// pastel sky with one card, no dashboard chrome (the visitor may be logged
// out). relative + isolate keeps the sky under the card.
export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <Sky />
      <NotFoundCard href="/" linkLabel="Przejdź do panelu" />
    </main>
  );
}
