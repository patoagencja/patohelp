"use client";

// TEMPORARY scratch (d26 screenshots) - delete before finishing.
import DashboardError from "@/app/(dashboard)/[clientSlug]/error";
import { SectionBoundary } from "@/components/dashboard/section-boundary";

function Boom(): JSX.Element {
  throw new Error("scratch: section failed");
}

export function FailingSection() {
  return (
    <SectionBoundary name="scratch">
      <Boom />
    </SectionBoundary>
  );
}

export function ErrorPreview() {
  return <DashboardError error={new Error("Przykładowy błąd")} reset={() => {}} />;
}
