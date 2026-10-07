import { z } from "zod";

import type { AbWindowKey } from "@/lib/ab/types";

import { AB_WINDOWS } from "./ab-meta";

// Kept apart from ab-meta.ts (which the client explorer imports) so zod
// stays out of the browser bundle: only the pages parse the URL.
const WindowParam = z.enum(AB_WINDOWS);

/** `?okno=` -> window; anything unknown (or "season" without a season) is 7 days. */
export function parseAbWindow(raw: string | undefined, seasonAllowed: boolean): AbWindowKey {
  const parsed = WindowParam.safeParse(raw);
  if (!parsed.success || (parsed.data === "season" && !seasonAllowed)) return "7d";
  return parsed.data;
}
