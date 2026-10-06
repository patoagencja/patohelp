"use client";

import { useParams } from "next/navigation";

import { NotFoundCard } from "@/components/dashboard/not-found-card";

// notFound() inside a client's dashboard: keep the shell (sidebar, header)
// and offer the way back to that client's overview.
export default function DashboardNotFound() {
  const params = useParams<{ clientSlug?: string }>();
  const slug = typeof params?.clientSlug === "string" ? params.clientSlug : "";
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10 sm:px-6">
      <NotFoundCard
        href={slug ? `/${slug}` : "/"}
        linkLabel="Wróć do przeglądu"
        description="Tej strony nie ma w panelu albo nie masz do niej dostępu."
      />
    </div>
  );
}
