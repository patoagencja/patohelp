import { RecordsCard } from "@/components/dashboard/records-card";
import { getCachedRecords } from "@/lib/dashboard/records";

/** Async wrapper so the overview can stream records in via Suspense. */
export async function RecordsSection({
  clientId,
  ecommerce,
}: {
  clientId: string;
  ecommerce: boolean;
}) {
  const records = await getCachedRecords(clientId, ecommerce);
  return <RecordsCard records={records} />;
}
