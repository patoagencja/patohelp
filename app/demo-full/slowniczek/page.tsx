import { GlossaryList } from "@/components/dashboard/glossary-list";

// Like every demo page: the demo layout reads search params (language), so
// static prerendering fails without this.
export const dynamic = "force-dynamic";

export default function DemoGlossaryPage() {
  return <GlossaryList isEcommerce />;
}
