"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";

// Agency-only quick switch between clients, preserving the current sub-page
// (e.g. /dre/reklamy -> /acme/reklamy).
export function ClientSwitcher({
  clients,
  current,
}: {
  clients: Array<{ slug: string; name: string }>;
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(slug: string) {
    if (!slug || slug === current) return;
    const rest = pathname.split("/").slice(2).join("/");
    router.push(`/${slug}${rest ? `/${rest}` : ""}`);
  }

  return (
    <div className="relative">
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Zmień klienta"
        className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
      >
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
