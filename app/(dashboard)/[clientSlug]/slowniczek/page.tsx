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
    <div className="p-6">
      <GlossaryList isEcommerce={client.clientType === "ecommerce"} />
    </div>
  );
}
