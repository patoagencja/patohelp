import { redirect } from "next/navigation";

// The demo is a single overview page. Any deeper link (e.g. a "Wszystkie alerty"
// click) bounces back to the demo instead of 404-ing.
export default function DemoCatchAll() {
  redirect("/demo");
}
