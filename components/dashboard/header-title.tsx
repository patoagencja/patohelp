"use client";

import { usePathname } from "next/navigation";

import { buildNav, findActive } from "@/components/dashboard/nav-items";

/**
 * "Where am I": the client we're looking at and the current page, always in
 * the header. On phones and tablets (no sidebar) the client's mark leads instead.
 */
export function HeaderTitle({
  clientName,
  base,
  isEcommerce,
  isAgency,
  brand,
}: {
  clientName: string;
  base: string;
  isEcommerce: boolean;
  isAgency: boolean;
  /** Client logo/wordmark for phones, where the sidebar is hidden. */
  brand?: React.ReactNode;
}) {
  const pathname = usePathname();
  const page = findActive(buildNav({ base, isEcommerce, isAgency }), pathname, base);

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {brand ? <span className="flex shrink-0 items-center lg:hidden">{brand}</span> : null}
      <p className="min-w-0 truncate text-[15px] leading-5">
        <span className="hidden text-muted-foreground lg:inline">{clientName}</span>
        {page ? (
          <>
            <span className="mx-2 hidden text-muted-foreground/60 lg:inline" aria-hidden>
              /
            </span>
            <span className="font-semibold text-foreground">{page.label}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
