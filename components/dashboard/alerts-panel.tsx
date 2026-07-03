import { Callout, Card, Title } from "@tremor/react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ClientAlert } from "@/lib/dashboard/overview";

const SEVERITY_META: Record<
  ClientAlert["severity"],
  { color: "red" | "amber" | "blue"; icon: typeof Info }
> = {
  critical: { color: "red", icon: ShieldAlert },
  warning: { color: "amber", icon: AlertTriangle },
  info: { color: "blue", icon: Info },
};

export function AlertsPanel({
  alerts,
  clientSlug,
  isAgency,
  dismissAction,
}: {
  alerts: ClientAlert[];
  clientSlug: string;
  isAgency: boolean;
  dismissAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <Card>
      <Title>Wymaga uwagi</Title>
      {alerts.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Brak aktywnych alertów — wszystko wygląda dobrze. ✅
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {alerts.map((alert) => {
            const meta = SEVERITY_META[alert.severity];
            return (
              <Callout
                key={alert.id}
                title={alert.title}
                color={meta.color}
                icon={meta.icon}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <span>{alert.description}</span>
                  {isAgency ? (
                    <form action={dismissAction} className="shrink-0">
                      <input type="hidden" name="client" value={clientSlug} />
                      <input type="hidden" name="alertId" value={alert.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                      >
                        Odrzuć
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Callout>
            );
          })}
        </div>
      )}
    </Card>
  );
}
