import { redirect } from "next/navigation";

import { GlossaryList } from "@/components/dashboard/glossary-list";
import { getClientBySlug } from "@/lib/dashboard/context";

export default async function GlossaryPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const client = await getClientBySlug(params.clientSlug);
  if (!client) redirect("/login");
  return (
    <div className="px-4 pb-6 pt-6 sm:px-6 md:pt-8">
      <GlossaryList isEcommerce={client.clientType === "ecommerce"} />
    </div>
  );
}
