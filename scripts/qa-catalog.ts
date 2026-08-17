/**
 * Deterministic QA tier — design decision D4, specs/07 §7 tier 1.
 *
 * Runs the SAME invariants module the unit tests use (lib/engine/invariants.ts) over every
 * real catalog course, and flags violations to `scheme_confidence='review'` with a queryable
 * reason in `qa_findings`.
 *
 * This runs in GitHub Actions, not Kubernetes. The engine is pure and synchronous, so ~1,600
 * courses take seconds — a correctness gate that requires launching a cluster is not a gate.
 * Only the LLM-bound QA tier is containerized.
 *
 *   npm run qa:catalog            # report and exit non-zero on violations
 *   npm run qa:catalog -- --write # also persist findings and update scheme_confidence
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

import { checkInvariants, type Violation } from '@/lib/engine';
import type { Assessment, Course, GradingRule } from '@/lib/types';

dotenv.config({ path: '.env.local' });

const WRITE = process.argv.includes('--write');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  section: string | null;
  term: string;
  credit_weight: number;
  grade_basis: string;
  grading_rules: GradingRule[] | null;
  scheme_confidence: string;
}

interface AssessmentRow {
  id: string;
  course_id: string;
  slug: string;
  name: string;
  category: string | null;
  assessment_type: string;
  weight: number;
  order_index: number;
}

/**
 * Build the fixture set for one catalog course.
 *
 * The catalog holds no marks, so the invariants have nothing to bite on unless we synthesize
 * them. Each fixture is a different shape of student progress, chosen to exercise the paths
 * where rules interact with status: all-upcoming, all-graded, mixed, boundary values, and the
 * excused-vs-missed distinction that the correctness rule turns on.
 */
function fixturesFor(course: Course): Array<{ label: string; course: Course }> {
  const setAll = (fn: (a: Assessment, i: number) => Partial<Assessment>): Course => ({
    ...course,
    assessments: course.assessments.map((a, i) => ({ ...a, ...fn(a, i) })),
  });

  return [
    { label: 'all-upcoming', course: setAll(() => ({ status: 'upcoming', grade: null })) },
    { label: 'all-graded-75', course: setAll(() => ({ status: 'graded', grade: 75 })) },
    { label: 'all-graded-0', course: setAll(() => ({ status: 'graded', grade: 0 })) },
    { label: 'all-graded-100', course: setAll(() => ({ status: 'graded', grade: 100 })) },
    {
      label: 'half-graded',
      course: setAll((_a, i) =>
        i % 2 === 0 ? { status: 'graded', grade: 68 } : { status: 'upcoming', grade: null },
      ),
    },
    {
      label: 'first-excused',
      course: setAll((_a, i) =>
        i === 0 ? { status: 'excused', grade: null } : { status: 'graded', grade: 80 },
      ),
    },
    {
      label: 'first-missed',
      course: setAll((_a, i) =>
        i === 0 ? { status: 'missed', grade: null } : { status: 'graded', grade: 80 },
      ),
    },
    // The boundary that matters most: a student who is passing on paper. If any rule turns
    // this into a displayed fail, that is the failure mode the whole contract exists to stop.
    { label: 'borderline-pass-50', course: setAll(() => ({ status: 'graded', grade: 50 })) },
  ];
}

function toCourse(row: CatalogRow, assessments: AssessmentRow[]): Course {
  return {
    id: row.id,
    catalogCourseId: row.id,
    code: row.code,
    name: row.name,
    section: row.section,
    creditWeight: Number(row.credit_weight),
    gradeBasis: row.grade_basis === 'cr_ncr' ? 'cr_ncr' : 'numeric',
    gradingRules: row.grading_rules ?? [],
    rulesOverridden: false,
    targetGrade: null,
    assessments: assessments.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      category: (a.category ?? null) as Assessment['category'],
      assessmentType: a.assessment_type,
      weight: Number(a.weight),
      orderIndex: a.order_index,
      grade: null,
      status: 'upcoming',
      isCustom: false,
      isRemoved: false,
    })),
  };
}

async function main() {
  const started = new Date().toISOString();

  const { data: courses, error: coursesError } = await db
    .from('catalog_courses')
    .select(
      'id, code, name, section, term, credit_weight, grade_basis, grading_rules, scheme_confidence',
    );

  if (coursesError) throw new Error(`Failed to load catalog: ${coursesError.message}`);
  if (!courses || courses.length === 0) {
    console.log('Catalog is empty — nothing to check.');
    return;
  }

  const { data: assessments, error: aError } = await db
    .from('catalog_assessments')
    .select('id, course_id, slug, name, category, assessment_type, weight, order_index');

  if (aError) throw new Error(`Failed to load assessments: ${aError.message}`);

  const byCourse = new Map<string, AssessmentRow[]>();
  for (const a of (assessments ?? []) as AssessmentRow[]) {
    const list = byCourse.get(a.course_id) ?? [];
    list.push(a);
    byCourse.set(a.course_id, list);
  }

  let runId: string | null = null;
  if (WRITE) {
    const { data } = await db
      .from('scrape_runs')
      .insert({ kind: 'qa', started_at: started })
      .select('id')
      .single();
    runId = data?.id ?? null;
  }

  const findings: Array<{
    catalog_course_id: string;
    scrape_run_id: string | null;
    tier: 'deterministic';
    severity: Violation['severity'];
    invariant: string;
    detail: Record<string, unknown>;
  }> = [];

  const flagged = new Set<string>();
  let checked = 0;

  for (const row of courses as CatalogRow[]) {
    const course = toCourse(row, byCourse.get(row.id) ?? []);

    for (const fixture of fixturesFor(course)) {
      checked += 1;
      for (const v of checkInvariants(fixture.course)) {
        findings.push({
          catalog_course_id: row.id,
          scrape_run_id: runId,
          tier: 'deterministic',
          severity: v.severity,
          invariant: v.invariant,
          detail: { ...v.detail, fixture: fixture.label, message: v.message },
        });
        if (v.severity === 'violation') flagged.add(row.id);
      }
    }
  }

  const violations = findings.filter((f) => f.severity === 'violation');

  console.log(
    `Checked ${courses.length} courses × ${checked / courses.length} fixtures ` +
      `(${checked} evaluations).`,
  );
  console.log(`${violations.length} violations, ${findings.length - violations.length} warnings.`);

  // Group by invariant so a systemic engine bug reads as one line rather than 1,600.
  const byInvariant = new Map<string, number>();
  for (const f of findings) {
    byInvariant.set(f.invariant, (byInvariant.get(f.invariant) ?? 0) + 1);
  }
  for (const [invariant, count] of [...byInvariant].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)}  ${invariant}`);
  }

  if (WRITE) {
    if (findings.length > 0) {
      // Chunked: a systemic failure can produce tens of thousands of rows.
      for (let i = 0; i < findings.length; i += 500) {
        const { error } = await db.from('qa_findings').insert(findings.slice(i, i + 500));
        if (error) throw new Error(`Failed to write findings: ${error.message}`);
      }
    }

    if (flagged.size > 0) {
      const { error } = await db
        .from('catalog_courses')
        .update({ scheme_confidence: 'review' })
        .in('id', [...flagged]);
      if (error) throw new Error(`Failed to flag courses: ${error.message}`);
      console.log(`Flagged ${flagged.size} courses to scheme_confidence='review'.`);
    }

    if (runId) {
      await db
        .from('scrape_runs')
        .update({
          finished_at: new Date().toISOString(),
          courses_seen: courses.length,
          courses_failed: flagged.size,
        })
        .eq('id', runId);
    }
  } else if (findings.length > 0) {
    console.log('\nRun with --write to persist findings and flag affected courses.');
  }

  // Non-zero exit fails the CI job. Warnings do not gate; violations do.
  if (violations.length > 0) {
    console.error(
      `\nSafety contract violated by ${flagged.size} course(s). ` +
        `See the invariant names above; definitions are in lib/engine/invariants.ts.`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
