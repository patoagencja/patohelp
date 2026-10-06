import { GoalTiles } from "@/components/dashboard/goal-tiles";
import { getActiveGoals } from "@/lib/dashboard/campaign-goals";

/**
 * Self-fetching goal row for pages that don't otherwise read the goals (the
 * overview). Request-cached, and a failed read renders nothing - stream it in
 * with <Suspense fallback={null}>.
 */
export async function LiveGoalTiles({
  clientId,
  baseHref,
  className,
}: {
  clientId: string;
  baseHref: string;
  className?: string;
}) {
  const goals = await getActiveGoals(clientId);
  return <GoalTiles goals={goals} baseHref={baseHref} className={className} />;
}
