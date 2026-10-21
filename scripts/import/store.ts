import { createClient } from "@supabase/supabase-js";
export function importDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("Missing Supabase import configuration.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function publishOfferingManifest(rows: any[]) {
  const db = importDatabase();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db
      .from("course_offerings")
      .upsert(rows.slice(i, i + 200), { onConflict: "code,term_id" });
    if (error) throw Error(error.message);
  }
}
export async function publishScheme(course: any, assessments: any[]) {
  const { data, error } = await importDatabase().rpc("publish_course_scheme", {
    p_course: course,
    p_assessments: assessments,
  });
  if (error) throw Error(error.message);
  return data;
}
