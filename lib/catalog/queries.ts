import { supabase } from "../supabase/client";
import { termInfo, normalizeCode, DEFAULT_TERM } from "./terms";
export interface Offering {
  code: string;
  name: string;
  term_id: number;
  term: string;
  outline_status: string;
  checked_at?: string;
  source_url?: string;
}
export interface Scheme {
  id: string;
  code: string;
  name: string;
  term: string;
  outline_url: string;
  validation_status: string;
  last_scraped: string;
}
function safeSearch(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .slice(0, 80);
}
export async function searchCatalog(query: string, term: number, page = 0) {
  const text = safeSearch(query),
    code = normalizeCode(text);
  const info = termInfo(term);
  const size = 12;
  let q = supabase
    .from("course_offerings")
    .select("code,name,term_id,term,outline_status,checked_at,source_url", {
      count: "exact",
    })
    .eq("term_id", term);
  if (text) q = q.or(`code.ilike.%${code}%,name.ilike.%${text}%`);
  const r = await q.order("code").range(page * size, page * size + size - 1);
  if (r.error)
    throw Error("The course catalog could not be loaded. Please retry.");
  if (r.count || term === DEFAULT_TERM)
    return { rows: r.data as Offering[], count: r.count || 0 };
  // Historical catalog was stored by outline rather than offering. Read all pages before deduplicating.
  const unique = new Map<string, Offering>();
  for (let offset = 0; ; offset += 1000) {
    let old = supabase
      .from("courses")
      .select("code,name,term,validation_status")
      .eq("term", info.label)
      .order("id")
      .range(offset, offset + 999);
    if (text) old = old.or(`code.ilike.%${code}%,name.ilike.%${text}%`);
    const result = await old;
    if (result.error) throw Error("Historical courses could not be loaded.");
    for (const c of result.data)
      if (!unique.has(c.code))
        unique.set(c.code, { ...c, term_id: term, outline_status: "legacy" });
    if (result.data.length < 1000) break;
  }
  const rows = [...unique.values()].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  return {
    rows: rows.slice(page * size, (page + 1) * size),
    count: rows.length,
  };
}
export async function catalogCounts(term: number) {
  const [all, ready] = await Promise.all([
    supabase
      .from("course_offerings")
      .select("code", { count: "exact", head: true })
      .eq("term_id", term),
    supabase
      .from("course_offerings")
      .select("code", { count: "exact", head: true })
      .eq("term_id", term)
      .eq("outline_status", "ready"),
  ]);
  if (all.error || ready.error) throw Error("Catalog totals unavailable.");
  return { total: all.count || 0, ready: ready.count || 0 };
}
export async function catalogTerms() {
  const ids = new Set([DEFAULT_TERM]);
  for (const table of ["courses", "course_offerings"]) {
    for (let offset = 0; ; offset += 1000) {
      const r = await supabase
        .from(table)
        .select("term_date")
        .order("term_date")
        .range(offset, offset + 999);
      if (r.error) throw Error("Terms could not be loaded.");
      for (const row of r.data) {
        const [year, month] = row.term_date.split("-").map(Number);
        const id = (year - 1900) * 10 + month;
        try {
          termInfo(id);
          ids.add(id);
        } catch {}
      }
      if (r.data.length < 1000) break;
    }
  }
  return [...ids].sort((a, b) => b - a);
}
export async function loadCourse(
  code: string,
  term: number,
  section?: string | null,
  explicitTerm = true,
) {
  let info = termInfo(term);
  if (section) {
    const direct = await supabase
      .from("courses")
      .select("*")
      .eq("id", section)
      .eq("code", code)
      .maybeSingle();
    if (direct.error) throw Error("This section could not be loaded.");
    if (!direct.data) throw Error("This course section does not exist.");
    if (direct.data.term !== info.label) {
      if (explicitTerm)
        throw Error(
          "This section belongs to another term. Choose its original term to view it.",
        );
      const [y, m] = direct.data.term_date.split("-").map(Number);
      term = (y - 1900) * 10 + m;
      info = termInfo(term);
    }
  }
  const [offering, sections] = await Promise.all([
    supabase
      .from("course_offerings")
      .select("*")
      .eq("code", code)
      .eq("term_id", term)
      .maybeSingle(),
    supabase
      .from("courses")
      .select("*")
      .eq("code", code)
      .eq("term", info.label)
      .order("name"),
  ]);
  if (offering.error || sections.error)
    throw Error("Course details could not be loaded. Please retry.");
  if (!offering.data && !sections.data.length)
    throw Error("This course is not listed for the selected term.");
  const selected =
    sections.data.find((c) => c.id === section) ||
    sections.data.find((c) => c.validation_status === "ready") ||
    sections.data[0];
  let assessments: any[] = [];
  if (selected) {
    const r = await supabase
      .from("assessments")
      .select("*")
      .eq("course_id", selected.id)
      .order("order_index");
    if (r.error) throw Error("Assessment weights could not be loaded.");
    assessments = r.data;
  }
  return {
    term,
    offering: offering.data as Offering | null,
    sections: sections.data as Scheme[],
    selected: selected as Scheme | undefined,
    assessments,
  };
}
