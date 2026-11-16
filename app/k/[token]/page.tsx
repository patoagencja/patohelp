import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { parseShareToken } from "@/lib/auth/share-link";
import { createClient } from "@/lib/supabase/server";

import { SharePasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kaleido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** "Link z hasłem" (lib/auth/share-link.ts): the password page. */
export default async function ShareLinkPage({ params }: { params: { token: string } }) {
  const parsed = parseShareToken(params.token);

  // Opened again on a device that is already in as this link: no password.
  if (parsed) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id === parsed.userId) {
      const { data: profile } = await supabase.from("users").select("client_id").eq("id", user.id).maybeSingle();
      const { data: client } = profile?.client_id
        ? await supabase.from("clients").select("slug").eq("id", profile.client_id).maybeSingle()
        : { data: null };
      if (client?.slug) redirect(`/${client.slug}`);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-5 pt-7">
          <div>
            <p className="kick">Kaleido</p>
            <h1 className="mt-2 text-[22px] font-medium tracking-[-0.03em]">Twój panel wyników</h1>
            <p className="mt-1.5 text-sm text-ink-2">
              {parsed
                ? "Wpisz hasło, które dostałeś od nas razem z linkiem."
                : "Ten link jest niepełny - skopiuj go jeszcze raz w całości."}
            </p>
          </div>
          {parsed ? <SharePasswordForm token={params.token} /> : null}
        </CardContent>
      </Card>
    </main>
  );
}
