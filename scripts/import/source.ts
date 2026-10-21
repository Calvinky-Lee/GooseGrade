import { normalizeCode, termInfo } from "../../lib/catalog/terms";
import * as cheerio from "cheerio";
export interface Outline {
  url: string;
  term: number;
  title?: string;
  courses?: { subject: string; code: string; section: string }[];
}
type Request = (url: string, init?: RequestInit) => Promise<Response>;
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function getSource(
  url: string,
  cookie: string,
  request: Request = fetch,
) {
  if (new URL(url).origin !== "https://outline.uwaterloo.ca")
    throw Error("Unexpected outline host.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await request(url, {
      headers: { Accept: "application/json,text/html", Cookie: cookie },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    if (r.status === 401 || r.status === 403)
      throw Error("Authentication failed. Refresh the Waterloo session.");
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await pause(Math.min(30000, 1000 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw Error(`Outline source HTTP ${r.status}`);
    return r;
  }
  throw Error("Outline source exhausted retries.");
}
export async function searchOutlines(
  code: string,
  term: number,
  cookie: string,
  request: Request = fetch,
) {
  const normalized = normalizeCode(code);
  let next: string | null =
    `https://outline.uwaterloo.ca/api/search/?q=${encodeURIComponent(normalized)}`;
  const seen = new Set<string>(),
    out = new Map<string, Outline>();
  while (next) {
    if (seen.has(next)) throw Error("Repeated pagination URL.");
    seen.add(next);
    if (seen.size > 200) throw Error("Search pagination limit exceeded.");
    const r = await getSource(next, cookie, request);
    if (!r.headers.get("content-type")?.includes("json"))
      throw Error("Expected authenticated JSON search response.");
    const j = await r.json();
    if (!Array.isArray(j.results))
      throw Error("Invalid outline search response.");
    for (const o of j.results as Outline[]) {
      const matches = o.courses
        ? o.courses.some(
            (c) => normalizeCode(`${c.subject} ${c.code}`) === normalized,
          )
        : new RegExp(`\\b${normalized.replace(" ", "\\s*")}\\b`, "i").test(
            o.title || "",
          );
      if (o.term === term && matches) {
        const url = new URL(o.url, "https://outline.uwaterloo.ca").href;
        if (new URL(url).origin !== "https://outline.uwaterloo.ca")
          throw Error("Unexpected outline host.");
        out.set(url, { ...o, url });
      }
    }
    next = j.next ? new URL(j.next, "https://outline.uwaterloo.ca").href : null;
  }
  return [...out.values()];
}
export function outlineText(html: string, code: string, term: number) {
  const $ = cheerio.load(html);
  $("script,style,nav,footer,svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const label = termInfo(term).label;
  if (
    !new RegExp(`\\b${normalizeCode(code).replace(" ", "\\s*")}\\b`, "i").test(
      text,
    ) ||
    !text.toLowerCase().includes(label.toLowerCase())
  )
    throw Error("Fetched outline does not confirm course and term.");
  return { text, title: $("h1").first().text().trim() || code };
}

// The viewer supports subject/term queries; the public search API does not.
export async function searchSubjectOutlines(subject: string, term: number, cookie: string, request: Request = fetch): Promise<Outline[]> {
 const info=termInfo(term);
 const suffix=`${term%10===1?'W':term%10===5?'S':'F'}${String(1900+Math.floor(term/10)).slice(-2)}`;
 const response=await getSource(`https://outline.uwaterloo.ca/viewer/api/search/?q=${encodeURIComponent(`${subject} ${suffix}`)}`,cookie,request);
 if(!response.headers.get('content-type')?.includes('json')) throw Error('Expected authenticated JSON search response.');
 const rows=await response.json();
 if(!Array.isArray(rows)) throw Error('Invalid viewer search response.');
 return rows.filter(o=>Number(o.term)===info.id&&o.url).map(o=>{
  const url=new URL(o.url,'https://outline.uwaterloo.ca').href;
  if(new URL(url).origin!=='https://outline.uwaterloo.ca')throw Error('Unexpected outline host.');
  const courses=[...String(o.courses).matchAll(/\b([A-Z]+)\s+(\d+[A-Z]*)\b/g)].map(m=>({subject:m[1],code:m[2],section:String(o.sections||'')}));
  if(!courses.length)throw Error('Viewer outline is missing course identity.');
  return {url,term:info.id,title:o.title,courses};
 });
}
