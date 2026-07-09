import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
} from "lucide-react";

import { detectAnomalies, type Anomaly } from "@/lib/alerts/anomalies";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SEVERITY_META: Record<
  Anomaly["severity"],
  { label: string; ring: string; badge: string }
> = {
  high: {
    label: "Wysoki",
    ring: "border-l-red-500",
    badge: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  },
  medium: {
    label: "Średni",
    ring: "border-l-amber-500",
    badge: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  },
};

function AnomalyCard({ a }: { a: Anomaly }) {
  const meta = SEVERITY_META[a.severity];
  const up = a.direction === "up";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-l-4 border-border bg-card p-4",
        meta.ring
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          meta.badge
        )}
      >
        {up ? (
          <ArrowUpRight className="h-4 w-4" />
        ) : (
          <ArrowDownRight className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{a.title}</p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              meta.badge
            )}
          >
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
            {a.scopeLabel}
          </span>
          <span>·</span>
          <span>{a.metric}</span>
        </div>
      </div>
    </div>
  );
}

export default async function AlertyPage({
  params,
}: {
  params: { clientSlug: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", params.clientSlug)
    .single();

  if (!client) {
    redirect("/login");
  }

  const anomalies = await detectAnomalies(client.id);
  const high = anomalies.filter((a) => a.severity === "high");
  const medium = anomalies.filter((a) => a.severity === "medium");

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Alerty - {client.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automatyczne wykrywanie anomalii: nagłe skoki i spadki z ostatnich 3
          dni względem poprzednich 2 tygodni.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <BellRing className="h-3.5 w-3.5" />
        Powiadomienia na WhatsApp - wkrótce. Alerty będą wysyłane automatycznie,
        gdy tylko podepniemy numer.
      </div>

      {anomalies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <CheckCircle2 className="mb-3 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium">Brak anomalii</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Wyniki trzymają się normy względem ostatnich dwóch tygodni. Sprawdzimy
            ponownie automatycznie.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {high.length > 0 ? (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Wymaga uwagi ({high.length})
              </h2>
              <div className="grid gap-3">
                {high.map((a) => (
                  <AnomalyCard key={a.id} a={a} />
                ))}
              </div>
            </section>
          ) : null}

          {medium.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                Warte obserwacji ({medium.length})
              </h2>
              <div className="grid gap-3">
                {medium.map((a) => (
                  <AnomalyCard key={a.id} a={a} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
