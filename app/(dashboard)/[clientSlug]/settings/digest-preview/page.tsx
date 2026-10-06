import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeft } from "lucide-react";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAgencyClientAccess } from "@/lib/integrations/guard";
import {
  buildWeeklyDigestEmail,
  loadWeeklyDigest,
} from "@/lib/notify/weekly-digest";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Agency-only preview of the Monday e-mail, built from this client's real
 * data for last week. Lets the account manager see exactly what the client
 * will get before ticking "Wysyłaj co poniedziałek" - nothing is sent.
 */
export default async function DigestPreviewPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const access = await requireAgencyClientAccess(params.clientSlug);
  if (!access.ok) notFound();

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, name, slug, client_type")
    .eq("id", access.clientId)
    .single();
  if (!client) notFound();

  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://dashboard.patoagencja.com";
  const content = await loadWeeklyDigest(
    admin,
    {
      id: client.id as string,
      name: client.name as string,
      slug: client.slug as string,
      ecommerce: (client as { client_type?: string }).client_type === "ecommerce",
    },
    today,
    appUrl
  ).catch(() => null);
  const email = content ? buildWeeklyDigestEmail(content) : null;

  return (
    <div className="space-y-6 px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <Link
        href={`/${params.clientSlug}/settings#powiadomienia`}
        className="inline-flex items-center gap-1.5 rounded-full text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Wróć do ustawień
      </Link>
      <PageHeader
        title="Podgląd maila „Twój tydzień w skrócie”"
        description={`Tak wyglądałby poniedziałkowy mail dla ${client.name as string} z danymi z ostatniego pełnego tygodnia. To tylko podgląd - nic nie zostało wysłane.`}
      />
      {email ? (
        <>
          <p className="text-sm">
            <span className="text-muted-foreground">Temat:</span>{" "}
            <span className="font-medium">{email.subject}</span>
          </p>
          <iframe
            title="Podgląd maila"
            srcDoc={email.html}
            sandbox=""
            className="h-[1400px] w-full max-w-[680px] rounded-card border border-hairline bg-white shadow-card"
          />
        </>
      ) : (
        <Card className="max-w-[680px] px-6 py-12 text-center text-sm text-muted-foreground">
          Brak danych za ostatni tydzień - mail nie zostałby wysłany.
        </Card>
      )}
    </div>
  );
}
