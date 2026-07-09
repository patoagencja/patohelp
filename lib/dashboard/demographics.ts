import { createAdminClient } from "@/lib/supabase/admin";

export interface DemoBucket {
  bucket: string;
  value: number;
}

export interface DemographicsData {
  hasData: boolean;
  // Age & gender prefer Meta (ad reach); fall back to GA4 (sessions).
  age: DemoBucket[];
  gender: DemoBucket[];
  ageSource: "meta" | "ga4" | null;
  genderSource: "meta" | "ga4" | null;
  geo: DemoBucket[]; // GA4 regions
}

const GENDER_LABELS: Record<string, string> = {
  male: "Mężczyźni",
  female: "Kobiety",
  unknown: "Nieznana",
};

/** Human-friendly gender label (GA4/Meta use english buckets). */
export function genderLabel(bucket: string): string {
  return GENDER_LABELS[bucket.toLowerCase()] ?? bucket;
}

const sortByValueDesc = (a: DemoBucket, b: DemoBucket) => b.value - a.value;
const sortByAge = (a: DemoBucket, b: DemoBucket) =>
  a.bucket.localeCompare(b.bucket);

/**
 * Latest demographics snapshot for a client. Uses the admin client (service
 * role) - the caller has already resolved an authorized client id.
 */
export async function getDemographics(clientId: string): Promise<DemographicsData> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("demographics")
    .select("provider, kind, bucket, value, snapshot_date")
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      hasData: false,
      age: [],
      gender: [],
      ageSource: null,
      genderSource: null,
      geo: [],
    };
  }

  // Keep only the newest snapshot date present.
  const latest = rows[0].snapshot_date as string;
  const current = rows.filter((r) => r.snapshot_date === latest);

  const pick = (provider: string, kind: string): DemoBucket[] =>
    current
      .filter((r) => r.provider === provider && r.kind === kind)
      .map((r) => ({ bucket: r.bucket as string, value: Number(r.value) }));

  const metaAge = pick("meta_ads", "age");
  const ga4Age = pick("ga4", "age");
  const metaGender = pick("meta_ads", "gender");
  const ga4Gender = pick("ga4", "gender");
  const geo = pick("ga4", "geo");

  const age = metaAge.length ? metaAge : ga4Age;
  const gender = metaGender.length ? metaGender : ga4Gender;

  return {
    hasData: age.length > 0 || gender.length > 0 || geo.length > 0,
    age: age.slice().sort(sortByAge),
    gender: gender.slice().sort(sortByValueDesc),
    ageSource: metaAge.length ? "meta" : ga4Age.length ? "ga4" : null,
    genderSource: metaGender.length ? "meta" : ga4Gender.length ? "ga4" : null,
    geo: geo.slice().sort(sortByValueDesc).slice(0, 8),
  };
}
