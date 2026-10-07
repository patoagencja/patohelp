import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { perfFetch } from "./perf";

/**
 * Service-role Supabase client. Bypasses RLS - use ONLY in server-only
 * contexts (cron routes, background sync). Never import from a Client
 * Component or expose the service-role key to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // PERF_LOG=1 only; undefined keeps the default fetch.
      global: { fetch: perfFetch("admin") },
    }
  );
}
