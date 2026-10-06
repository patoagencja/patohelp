import { cache } from "react";

import { RecordsCard } from "@/components/dashboard/records-card";
import { getCachedRecords } from "@/lib/dashboard/records";

// Per-request memo so a page can start the read early (preloadRecords) and
// the streamed section below picks up the same promise. Without it the read
// only began once the page's own data had resolved and its JSX rendered.
const getRecordsForRequest = cache(getCachedRecords);

/** Start the records read now; <RecordsSection> reuses the same promise. */
export function preloadRecords(clientId: string, ecommerce: boolean): void {
  // Any failure surfaces where the section awaits it (inside its boundary);
  // this only keeps Node from flagging the early promise as unhandled.
  getRecordsForRequest(clientId, ecommerce).catch(() => {});
}

/** Async wrapper so the overview can stream records in via Suspense. */
export async function RecordsSection({
  clientId,
  ecommerce,
}: {
  clientId: string;
  ecommerce: boolean;
}) {
  const records = await getRecordsForRequest(clientId, ecommerce);
  return <RecordsCard records={records} />;
}
