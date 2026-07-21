"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";

// Native <select> + native date inputs (not Tremor's custom Select) so it
// always hydrates and fires. Presets navigate via ?range=; the custom option
// reveals from/to date fields and navigates via ?from=&to= (which overrides
// the preset server-side).
export function DateRangePicker({
  value,
  customFrom,
  customTo,
}: {
  value: RangeKey;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasCustom = Boolean(customFrom && customTo);
  const [custom, setCustom] = useState(hasCustom);
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`${pathname}?${params.toString()}`);
    // Next 14 may serve the cached RSC payload when only search params
    // change - force a server re-render so the data actually updates.
    router.refresh();
  }

  function onSelect(next: string) {
    if (next === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    navigate((p) => {
      p.set("range", next);
      p.delete("from");
      p.delete("to");
    });
  }

  function applyCustom() {
    if (!from || !to || from > to) return;
    navigate((p) => {
      p.set("from", from);
      p.set("to", to);
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {custom ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Data od"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Data do"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to || from > to}
            className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            OK
          </button>
        </div>
      ) : null}

      <div className="relative w-full sm:w-52">
        <select
          value={custom ? "custom" : value}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Zakres dat"
          className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-card px-3 py-2 pr-9 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
        >
          {RANGE_KEYS.map((key) => (
            <option key={key} value={key}>
              {RANGE_LABELS[key]}
            </option>
          ))}
          <option value="custom">Własny zakres…</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
