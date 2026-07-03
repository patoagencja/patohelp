"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectItem } from "@tremor/react";

import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/dashboard/ranges";

export function DateRangePicker({ value }: { value: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select
      value={value}
      onValueChange={onChange}
      enableClear={false}
      className="w-full sm:w-52"
    >
      {RANGE_KEYS.map((key) => (
        <SelectItem key={key} value={key}>
          {RANGE_LABELS[key]}
        </SelectItem>
      ))}
    </Select>
  );
}
