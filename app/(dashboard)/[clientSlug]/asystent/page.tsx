import { redirect } from "next/navigation";

import { AiChat } from "@/components/dashboard/ai-chat";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Asystent AI — {client.name}</h1>
      <AiChat clientSlug={params.clientSlug} />
    </div>
  );
}
