import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { formatInTimeZone } from "date-fns-tz";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseDemoProfile, type DemoProfile } from "@/lib/demo/profile/anonymize";
import { demoSourceFor, type DemoSource } from "@/lib/demo/source";
import { createAdminClient } from "@/lib/supabase/admin";

// Where the demo profile lives: one report_cache row (migration 0013 -
// RLS on, no policies, service role only) under a fixed cache_key, on the
// source client's id. There is only ever one: saving deletes the key for
// every client first. The public demo reads the payload alone, never the
// client id, through a 10-minute cache the admin's actions invalidate.

export const DEMO_PROFILE_KEY = "demo-profile";
export const DEMO_PROFILE_TAG = "demo-profile";

const readStored = unstable_cache(
  async (): Promise<unknown> => {
    const { data, error } = await createAdminClient()
      .from("report_cache")
      .select("payload")
      .eq("cache_key", DEMO_PROFILE_KEY)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Thrown, so a failed read isn't cached as "no profile" for 10 minutes.
    if (error) throw new Error(error.message);
    return (data?.payload as unknown) ?? null;
  },
  ["demo-profile-v1"],
  { revalidate: 600, tags: [DEMO_PROFILE_TAG] }
);

/**
 * Local development only: DEMO_PROFILE_FILE points at a profile JSON (e.g.
 * lib/demo/profile/dev-profile.json, a made-up shop), so the demo can be
 * checked against a "real" profile without a database. Ignored in production.
 */
async function readDevFile(): Promise<unknown | undefined> {
  const file = process.env.DEMO_PROFILE_FILE;
  if (!file || process.env.NODE_ENV === "production") return undefined;
  return JSON.parse(await readFile(resolve(process.cwd(), file), "utf8"));
}

/** The stored profile, checked; null when there is none or anything fails. */
export async function readDemoProfile(): Promise<DemoProfile | null> {
  try {
    const dev = await readDevFile();
    if (dev !== undefined) return parseDemoProfile(dev);
  } catch {
    return null;
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    return parseDemoProfile(await readStored());
  } catch {
    return null;
  }
}

/**
 * The demo's data for this request: the stored profile when there is a fresh
 * one, else the synthetic shop. Request-deduped (layout + page read it once).
 */
export const getDemoSource = cache(async (): Promise<DemoSource> => {
  const today = formatInTimeZone(new Date(), "Europe/Warsaw", "yyyy-MM-dd");
  const devFile = Boolean(process.env.DEMO_PROFILE_FILE) && process.env.NODE_ENV !== "production";
  return demoSourceFor(await readDemoProfile(), today, devFile);
});

// ---- the admin side (settings) ----------------------------------------------------

/** Replaces whatever profile the demo had with this client's. */
export async function saveDemoProfile(admin: SupabaseClient, clientId: string, profile: DemoProfile): Promise<string | null> {
  const del = await admin.from("report_cache").delete().eq("cache_key", DEMO_PROFILE_KEY);
  if (del.error) return del.error.message;
  const ins = await admin.from("report_cache").insert({
    client_id: clientId,
    cache_key: DEMO_PROFILE_KEY,
    payload: profile,
    generated_at: new Date().toISOString(),
  });
  return ins.error ? ins.error.message : null;
}

/** Back to the synthetic shop. */
export async function clearDemoProfile(admin: SupabaseClient): Promise<string | null> {
  const { error } = await admin.from("report_cache").delete().eq("cache_key", DEMO_PROFILE_KEY);
  return error ? error.message : null;
}

export interface DemoProfileStatus {
  /** Whose numbers the demo shows. */
  source: "this" | "other" | "none";
  profile: DemoProfile | null;
}

export async function getDemoProfileStatus(admin: SupabaseClient, clientId: string): Promise<DemoProfileStatus> {
  const { data, error } = await admin
    .from("report_cache")
    .select("client_id, payload")
    .eq("cache_key", DEMO_PROFILE_KEY)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { source: "none", profile: null };
  return {
    source: data.client_id === clientId ? "this" : "other",
    profile: parseDemoProfile(data.payload),
  };
}
