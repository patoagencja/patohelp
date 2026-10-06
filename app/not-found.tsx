import { NotFoundCard } from "@/components/dashboard/not-found-card";

export const metadata = { title: "Nie znaleziono strony - Pato Dashboard" };

// Unknown URLs and expired/invalid share links (/s, /r) land here: the warm
// v2 canvas with one card, no dashboard chrome (the visitor may be logged out).
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <NotFoundCard href="/" linkLabel="Przejdź do panelu" />
    </main>
  );
}
