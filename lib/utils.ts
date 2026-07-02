import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, resolving conflicts (shadcn convention).
 * Additional formatters (money, dates) are added in Phase 1 point 10.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
