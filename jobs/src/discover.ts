/**
 * Course discovery — closes the gap that made `scrape` unable to populate a fresh term.
 *
 * `scrape` re-extracts catalog rows that already carry an outline_url. Something has to CREATE
 * those rows, and in v1 that was two disconnected manual steps: fetch-course-list.ts wrote a
 * courses.txt file, and scrape-batch.ts read it back. Nothing wrote the discovered outlines to
 * the database, so a new term produced an empty catalog and `scrape` processed zero courses.
 *
 * This does both halves in one pass and writes the rows:
 *   1. enumerate every subject + catalog number offered (classes.uwaterloo.ca)
 *   2. ask outline.uwaterloo.ca which outlines exist for each, in the target term
 *   3. upsert one catalog_courses row per section, with its outline_url and no scheme yet
 *
 * The scheme is left for `scrape`, which is what makes the two steps independently retryable:
 * discovery is cheap and idempotent, extraction is expensive.
 */

import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

import { db, finishRun, startRun } from './db';
import { politeDelay } from './fetch';
import { partition, resolveShard } from './shard';
import { encodeTerm } from './term';

const COURSE_LIST_URL = 'https://classes.uwaterloo.ca/uwpcshtm.html';
const OUTLINE_BASE = 'https://outline.uwaterloo.ca';

export interface DiscoverOptions {
  term: string;
  limit?: number;
  dryRun?: boolean;
  /** Restrict to one subject, e.g. --subject CS. Useful for a cheap first run. */
  subject?: string;
}

interface OutlineSearchResult {
  url: string;
  term: number;
  title?: string;
  subject?: string;
  catalogNumber?: string;
}

/** Every course code UW currently lists. Public page, no cookie needed. */
export async function fetchCourseCodes(): Promise<string[]> {
  const response = await fetch(COURSE_LIST_URL, {
    headers: { 'User-Agent': 'GooseGrade/2.0 (course indexer)' },
  });
  if (!response.ok) {
    throw new Error(`Course list fetch failed ${response.status}: ${COURSE_LIST_URL}`);
  }

  const $ = cheerio.load(await response.text());
  const codes = new Set<string>();

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const subject = $(cells[0]).text().trim().toUpperCase();
    const catalogNumber = $(cells[1]).text().trim().toUpperCase();
    if (/^[A-Z]{2,6}$/.test(subject) && /^\d{2,3}[A-Z]?$/.test(catalogNumber)) {
      codes.add(`${subject} ${catalogNumber}`);
    }
  });

  return [...codes].sort();
}

/**
 * Which outlines exist for a course in a given term.
 *
 * v1 hard-coded the term filter to 1261 here too — this takes it as an argument, which is the
 * other half of B5.1 (the CLI flag was only the first half).
 */
export async function findOutlines(
  code: string,
  termCode: number,
): Promise<OutlineSearchResult[]> {
  const url = `${OUTLINE_BASE}/api/search?q=${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GooseGrade/2.0 (course indexer)',
      Cookie: process.env.WATERLOO_SESSION_COOKIE ?? '',
    },
  });

  if (!response.ok) return [];

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    // An HTML body here means the session cookie has expired and we were redirected to a login
    // page. Returning [] would silently discover nothing for every course, so say so loudly.
    throw new Error(
      `Outline search returned HTML rather than JSON for ${code} — ` +
        'WATERLOO_SESSION_COOKIE is probably expired.',
    );
  }

  const body = (await response.json()) as { results?: OutlineSearchResult[] };
  return (body.results ?? []).filter((r) => r.term === termCode);
}

/**
 * "…/view/CS/240/001/12345" → "001", so sections stay distinguishable.
 *
 * The path fallback is POSITIONAL, not a search for the first three-digit segment: a catalog
 * number like 240 is also three digits and sits earlier in the path, so a naive scan returns
 * the course number as the section — which would then collide every section of that course
 * onto one row.
 */
export function sectionFromUrl(url: string, title?: string): string | null {
  const fromTitle = title?.match(/\b(?:LEC|ONLINE|SEM|TUT|LAB)\s*(\d{3})\b/i);
  if (fromTitle) return fromTitle[1];

  const parts = url.split('/').filter(Boolean);
  // Locate the subject segment, then step over the catalog number to reach the section.
  // Case-SENSITIVE on purpose: course subjects are uppercase ("CS"), while path words like
  // "view" are not — a case-insensitive test matches "view" as a subject and derails the walk.
  const subjectAt = parts.findIndex((p) => /^[A-Z]{2,6}$/.test(p));
  if (subjectAt === -1) return null;

  const catalogAt = subjectAt + 1;
  if (!/^\d{2,3}[A-Z]?$/.test(parts[catalogAt] ?? '')) return null;

  const section = parts[catalogAt + 1];
  return section && /^\d{3}$/.test(section) ? section : null;
}

/** First day of the UW term, for term_date ordering. */
export function termDate(termLabel: string): string {
  const [season, year] = termLabel.split(/\s+/);
  const month = season === 'Winter' ? '01' : season === 'Spring' ? '05' : '09';
  return `${year}-${month}-01`;
}

export async function runDiscover(opts: DiscoverOptions) {
  const shard = resolveShard();
  const termCode = Number(encodeTerm(opts.term));

  const runId = await startRun({
    kind: 'scrape',
    term: opts.term,
    shardIndex: shard.index,
    shardCount: shard.count,
    model: null,
  });

  console.log(
    `[discover] term=${opts.term} (${termCode}) shard=${shard.index + 1}/${shard.count} ` +
      `(${shard.source})`,
  );

  let codes = await fetchCourseCodes();
  console.log(`[discover] ${codes.length} course codes offered`);

  if (opts.subject) {
    const subject = opts.subject.toUpperCase();
    codes = codes.filter((c) => c.startsWith(`${subject} `));
    console.log(`[discover] ${codes.length} after --subject ${subject}`);
  }

  codes = partition(codes, shard);
  if (opts.limit) codes = codes.slice(0, opts.limit);

  const totals = {
    coursesSeen: 0,
    coursesWritten: 0,
    coursesSkipped: 0,
    coursesFailed: 0,
  };

  const date = termDate(opts.term);

  for (const code of codes) {
    totals.coursesSeen += 1;
    try {
      await politeDelay(600);
      const outlines = await findOutlines(code, termCode);

      if (outlines.length === 0) {
        // Normal: most courses are not offered every term.
        totals.coursesSkipped += 1;
        continue;
      }

      const rows = outlines.map((outline) => ({
        code,
        name: outline.title?.trim() || code,
        department: code.split(' ')[0],
        term: opts.term,
        term_date: date,
        section: sectionFromUrl(outline.url, outline.title),
        outline_url: outline.url.startsWith('http') ? outline.url : `${OUTLINE_BASE}${outline.url}`,
      }));

      if (opts.dryRun) {
        console.log(`  ~ ${code} [dry-run] ${rows.length} outline(s)`);
        continue;
      }

      // Idempotent: re-running discovery must not duplicate rows or clobber a scheme that
      // `scrape` has already extracted. The unique key is (code, term, section, outline_url),
      // and this upsert deliberately touches none of the scheme columns.
      const { error } = await db()
        .from('catalog_courses')
        .upsert(rows, { onConflict: 'code,term,section,outline_url', ignoreDuplicates: false });

      if (error) throw new Error(error.message);

      totals.coursesWritten += rows.length;
      console.log(`  + ${code} ${rows.length} section(s)`);
    } catch (error) {
      totals.coursesFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ! ${code} ${message}`);

      // An expired cookie fails identically for every remaining course, so stop rather than
      // logging 1,600 identical warnings.
      if (message.includes('WATERLOO_SESSION_COOKIE')) {
        await finishRun(runId, { ...totals, error: message });
        throw error;
      }
    }
  }

  await finishRun(runId, totals);
  console.log(
    `[discover] done: ${totals.coursesWritten} sections written, ` +
      `${totals.coursesSkipped} not offered, ${totals.coursesFailed} failed`,
  );
  return totals;
}
