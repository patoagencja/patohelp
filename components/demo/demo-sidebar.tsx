"use client";

import { useSearchParams } from "next/navigation";

import { buildNav } from "@/components/dashboard/nav-items";
import { SidebarNav } from "@/components/dashboard/sidebar";

const BASE = "/demo-full";

// Same navigation as a real e-commerce client; the public demo has no report.
export function DemoSidebar() {
  const sp = useSearchParams();
  const suffix = sp.get("lang") === "en" ? "?lang=en" : "";
  const groups = buildNav({
    base: BASE,
    isEcommerce: true,
    isAgency: false,
    omit: [`${BASE}/raport`],
  });
  return <SidebarNav groups={groups} base={BASE} linkSuffix={suffix} />;
}
