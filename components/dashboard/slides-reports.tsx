import { Presentation } from "lucide-react";

import { GenerateSlidesButton } from "@/components/dashboard/slides-reports-button";
import { addReportTemplate } from "@/lib/report/slides-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CampaignFilter } from "@/lib/report/segment-data";

// Agency-only section on the Raport tab: the client's recurring Google Slides
// decks - last generated copy per template, a generate-now button, and a form
// to register a new template. Data writes happen via server action / API.
export async function SlidesReports({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const admin = createAdminClient();

  const [{ data: templates }, { data: runs }, { data: slidesInteg }] =
    await Promise.all([
      admin
        .from("report_templates")
        .select("id, name, campaign_filter, active, sort_order")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("report_runs")
        .select("template_id, month, presentation_url, status, error, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("integrations")
        .select("id")
        .eq("client_id", clientId)
        .eq("provider", "google_slides")
        .maybeSingle(),
    ]);

  const connected = !!slidesInteg;
  const latestByTemplate = new Map<
    string,
    { month: string; url: string | null; status: string; error: string | null }
  >();
  for (const r of runs ?? []) {
    if (!latestByTemplate.has(r.template_id as string)) {
      latestByTemplate.set(r.template_id as string, {
        month: r.month as string,
        url: r.presentation_url as string | null,
        status: r.status as string,
        error: r.error as string | null,
      });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Presentation className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">
            Raporty miesięczne (szablon OLX v3)
          </h2>
        </div>
        {connected && <GenerateSlidesButton clientSlug={clientSlug} />}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        Każdy raport = segment kampanii (filtr po nazwie). Panel wypełnia
        oficjalny szablon OLX v3 danymi Meta/Google za dany miesiąc + analizą
        AI i daje gotowy PPTX — bez Google, wszystko po naszej stronie.
        Miniaturki kreacji na slajdzie 3 wklejasz ręcznie, cała reszta
        wypełnia się sama.
      </p>

      {templates?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Raport</th>
                <th className="py-2 pr-3">Filtr kampanii</th>
                <th className="py-2 pr-3">Ostatni wygenerowany</th>
                <th className="py-2">Link</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const f = t.campaign_filter as CampaignFilter;
                const last = latestByTemplate.get(t.id as string);
                return (
                  <tr key={t.id as string} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium">
                      {t.name as string}
                      {!t.active && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          wyłączony
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {(f.all_of ?? []).join(" + ") || "wszystkie"}
                      {f.any_of?.length ? ` (${f.any_of.join(" / ")})` : ""}
                    </td>
                    <td className="py-2 pr-3">
                      {last ? (
                        last.status === "ok" ? (
                          last.month
                        ) : (
                          <span className="text-red-600" title={last.error ?? ""}>
                            błąd ({last.month})
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-3">
                        <a
                          href={`/api/report/olx-v3?client=${clientSlug}&template=${t.id as string}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Pobierz PPTX
                        </a>
                        {last?.url && (
                          <a
                            href={last.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground underline-offset-2 hover:underline"
                          >
                            Slides
                          </a>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Brak szablonów. Dodaj pierwszy poniżej — wklej ID pliku Slides
          (z adresu <code>docs.google.com/presentation/d/&lt;ID&gt;/edit</code>).
        </p>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          + Dodaj szablon raportu
        </summary>
        <form action={addReportTemplate} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="client_slug" value={clientSlug} />
          <label className="text-sm">
            Nazwa raportu
            <input
              name="name"
              required
              placeholder="np. Goods CEP"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="text-sm">
            Kampania musi zawierać (przecinki)
            <input
              name="all_of"
              placeholder="np. GOODS, CEP"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="text-sm">
            ...i co najmniej jedno z (opcjonalnie)
            <input
              name="any_of"
              placeholder="np. FEED, KATALOG"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="text-sm">
            ID pliku Slides (opcjonalnie — tylko dla wersji Google)
            <input
              name="template_presentation_id"
              placeholder="puste = wbudowany szablon OLX v3"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="text-sm">
            Folder Google Drive (ID, opcjonalnie)
            <input
              name="drive_folder_id"
              placeholder="tylko dla wersji Google Slides"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Zapisz szablon
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}
