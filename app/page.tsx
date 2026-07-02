import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isAgencyUser, type UserRole } from "@/lib/types";

// Landing route. Sends the visitor to the right place:
//   * not logged in            -> /login
//   * agency user (admin/member) -> /dre (MVP's only client)
//   * client user              -> /<their client slug>
export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, client_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  if (isAgencyUser(profile.role as UserRole)) {
    redirect("/dre");
  }

  if (profile.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("slug")
      .eq("id", profile.client_id)
      .single();

    if (client?.slug) {
      redirect(`/${client.slug}`);
    }
  }

  redirect("/login");
}
