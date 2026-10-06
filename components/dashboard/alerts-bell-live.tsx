import { AlertsBell } from "@/components/dashboard/header-menu";
import { countAttentionAlerts, getCurrentAlerts } from "@/lib/alerts/current";

/**
 * The header bell with its live count. Rendered inside <Suspense> in the
 * layout (fallback: the plain bell), so the anomaly scan never holds back
 * the shell. A failed scan just leaves the bell without a badge.
 */
export async function AlertsBellLive({ clientId, href }: { clientId: string; href: string }) {
  let count = 0;
  try {
    count = countAttentionAlerts(await getCurrentAlerts(clientId));
  } catch {
    count = 0;
  }
  return <AlertsBell href={href} count={count} />;
}
