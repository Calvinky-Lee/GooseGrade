/**
 * lib/api integration — B3.5 acceptance: "an integration test seeds data and exercises every
 * function", and specs/01 §Testing item 3.
 *
 * liveApi is the one part of the codebase that unit tests cannot reach: every mapper, RPC call
 * and nested select in it is only exercised by a real PostgREST response. The mock passing tells
 * us nothing about whether `credit_weight` arrives as a string, or whether the fork RPC returns
 * what we claim.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npm run test:db
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeCourse, computeTermAverage } from '@goosegrade/engine';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const configured = Boolean(url && serviceKey && anonKey);
const describeIf = configured ? describe : describe.skip;

const USER = { email: `api-int-${Date.now()}@uwaterloo.ca`, password: 'test-password-i1!' };

describeIf('liveApi against a real database', () => {
  // Imported lazily so the module does not construct a client when the suite is skipped.
  let api: typeof import('@goosegrade/api').liveApi;
  let admin: ReturnType<typeof createClient>;
  let userId = '';
  let catalogCourseId = '';
  let termId = '';
  let courseId = '';

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;

    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });

    const created = await admin.auth.admin.createUser({
      email: USER.email,
      password: USER.password,
      email_confirm: true,
    });
    if (created.error) throw new Error(created.error.message);
    userId = created.data.user.id;

    // Seed a catalog course with a real rule, so fork-on-add has something meaningful to copy.
    const cat = await admin
      .from('catalog_courses')
      .insert({
        code: 'INT 101',
        name: 'Integration Course',
        department: 'INT',
        term: 'Integration Term',
        term_date: '2026-01-01',
        section: '001',
        credit_weight: 0.5,
        grade_basis: 'numeric',
        scheme_confidence: 'verified',
        outline_url: `https://example.invalid/int101-${Date.now()}`,
        grading_rules: [
          {
            id: 'int-best',
            type: 'bestNofM',
            enabled: true,
            source: 'scraped',
            description: 'Best 1 of 2 quizzes',
            group: { category: 'Quiz' },
            take: 1,
          },
        ],
      })
      .select('id')
      .single();
    if (cat.error) throw new Error(cat.error.message);
    catalogCourseId = (cat.data as { id: string }).id;

    await admin.from('catalog_assessments').insert([
      { course_id: catalogCourseId, slug: 'quiz-1', name: 'Quiz 1', category: 'Quiz', assessment_type: 'Quiz', weight: 10, total_weight: 10, order_index: 1 },
      { course_id: catalogCourseId, slug: 'quiz-2', name: 'Quiz 2', category: 'Quiz', assessment_type: 'Quiz', weight: 10, total_weight: 10, order_index: 2 },
      { course_id: catalogCourseId, slug: 'final-exam', name: 'Final Exam', category: 'Final Exam', assessment_type: 'Final Exam', weight: 80, total_weight: 80, order_index: 3 },
    ]);

    const mod = await import('@goosegrade/api');
    api = mod.liveApi;
    await api.signIn(USER.email, USER.password);
  }, 60_000);

  afterAll(async () => {
    if (!configured) return;
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (catalogCourseId) await admin.from('catalog_courses').delete().eq('id', catalogCourseId);
  }, 60_000);

  it('signs in and returns a session', async () => {
    const session = await api.getSession();
    expect(session?.email).toBe(USER.email);
  });

  it('auto-created a profile via the signup trigger', async () => {
    const profile = await api.getProfile();
    expect(profile.email).toBe(USER.email);
    // Contributing must default OFF — give-to-get is opt-in.
    expect(profile.settings.contributeDistributions).toBe(false);
  });

  it('updates the profile and round-trips settings JSON', async () => {
    const updated = await api.updateProfile({
      program: 'Integration',
      settings: { contributeDistributions: true, theme: 'dark' },
    });
    expect(updated.program).toBe('Integration');
    expect(updated.settings.theme).toBe('dark');
  });

  it('searches the catalog', async () => {
    const results = await api.searchCatalog('INT 101');
    expect(results.some((r) => r.id === catalogCourseId)).toBe(true);
    // The mapper must convert numeric-as-string; a string here breaks every average silently.
    const found = results.find((r) => r.id === catalogCourseId)!;
    expect(typeof found.creditWeight).toBe('number');
  });

  it('reads a catalog course with its assessments and rules', async () => {
    const [detail] = await api.getCatalogCourse('INT 101', 'Integration Term');
    expect(detail.assessments).toHaveLength(3);
    expect(detail.gradingRules).toHaveLength(1);
    // A catalog course is a template: no marks.
    expect(detail.assessments.every((a) => a.grade === null)).toBe(true);
    expect(typeof detail.assessments[0].weight).toBe('number');
  });

  it('creates a term', async () => {
    const term = await api.createTerm('Integration Term', '2026-01-01');
    termId = term.id;
    expect(term.isCurrent).toBe(true);
  });

  it('forks a catalog course, copying assessments and rules', async () => {
    const course = await api.addCourseFromCatalog(catalogCourseId, termId);
    courseId = course.id;

    expect(course.assessments).toHaveLength(3);
    expect(course.gradingRules).toHaveLength(1);
    expect(course.rulesOverridden).toBe(false);
    // Forked assessments carry no marks and are typed as numbers, not strings.
    expect(course.assessments.every((a) => a.grade === null)).toBe(true);
    expect(typeof course.assessments[0].weight).toBe('number');
  });

  it('refuses to add the same catalog course twice', async () => {
    // Enforced by a unique index AND the fork RPC; this proves the error maps onto the shared
    // vocabulary rather than surfacing a raw Postgres string.
    await expect(api.addCourseFromCatalog(catalogCourseId, termId)).rejects.toMatchObject({
      code: 'course/already-added',
    });
  });

  it('setGrade persists and returns a recomputed result', async () => {
    const course = await api.getCourse(courseId);
    const quiz = course.assessments.find((a) => a.slug === 'quiz-1')!;

    const { assessment, result } = await api.setGrade(quiz.id, 90);
    expect(assessment.grade).toBe(90);
    expect(assessment.status).toBe('graded');
    expect(result.currentGrade).toBeCloseTo(90, 6);
  });

  it('getCurrentTerm returns one fully-populated payload the engine can consume', async () => {
    const term = await api.getCurrentTerm();
    expect(term).not.toBeNull();

    const course = term!.courses.find((c) => c.id === courseId)!;
    expect(course.assessments.length).toBe(3);

    // The whole point of the nested select: the dashboard computes locally with no N+1.
    const average = computeTermAverage(term!.courses);
    expect(average.average).not.toBeNull();
    expect(computeCourse(course).currentGrade).toBeCloseTo(90, 6);
  });

  it('clearing a mark returns the item to upcoming rather than scoring zero', async () => {
    const course = await api.getCourse(courseId);
    const quiz = course.assessments.find((a) => a.slug === 'quiz-1')!;

    const { assessment } = await api.setGrade(quiz.id, null);
    expect(assessment.grade).toBeNull();
    expect(assessment.status).toBe('upcoming');
  });

  it('rejects an out-of-range mark', async () => {
    const course = await api.getCourse(courseId);
    await expect(api.setGrade(course.assessments[0].id, 900)).rejects.toMatchObject({
      code: 'validation/invalid-input',
    });
  });

  it('adds a custom assessment with a de-duplicated slug', async () => {
    const first = await api.addAssessment(courseId, { name: 'Quiz 1', weight: 5 });
    // "quiz-1" is taken by the forked catalog item, so this must not collide.
    expect(first.slug).not.toBe('quiz-1');
    expect(first.isCustom).toBe(true);
  });

  it('reorders assessments', async () => {
    const course = await api.getCourse(courseId);
    const reversed = [...course.assessments].reverse().map((a) => a.id);
    await api.reorderAssessments(courseId, reversed);

    const after = await api.getCourse(courseId);
    expect(after.assessments[0].id).toBe(reversed[0]);
  });

  it('editing rules sets rules_overridden, and reset restores them preserving marks', async () => {
    const course = await api.getCourse(courseId);
    const final = course.assessments.find((a) => a.slug === 'final-exam')!;
    await api.setGrade(final.id, 77);

    const overridden = await api.updateCourse(courseId, { gradingRules: [] });
    expect(overridden.rulesOverridden).toBe(true);
    expect(overridden.gradingRules).toHaveLength(0);

    const reset = await api.resetCourseToCatalog(courseId);
    expect(reset.rulesOverridden).toBe(false);
    expect(reset.gradingRules).toHaveLength(1);

    // The marks must survive. Losing a grade to a "reset rules" action would be unforgivable.
    const keptMark = reset.assessments.find((a) => a.slug === 'final-exam');
    expect(keptMark?.grade).toBe(77);
  });

  it('soft-removes an assessment rather than deleting it', async () => {
    const course = await api.getCourse(courseId);
    const target = course.assessments.find((a) => a.isCustom)!;
    await api.removeAssessment(target.id);

    const after = await api.getCourse(courseId);
    const still = after.assessments.find((a) => a.id === target.id);
    expect(still?.isRemoved).toBe(true);
  });

  it('contributes grades keyed by slug and reports what it skipped', async () => {
    const result = await api.contributeGrades(courseId);
    expect(result.contributed).toBeGreaterThan(0);
    // Custom items have no catalog counterpart, so they must be reported rather than silently
    // dropped (amendment A5).
    expect(result.skipped.some((s) => s.reason === 'custom' || s.reason === 'not_graded')).toBe(true);
  });

  it('returns no distribution below the minimum-sample floor', async () => {
    const dist = await api.getCourseDistribution(catalogCourseId, 'Integration Term');
    // One contributor is far below the floor of 5. Nothing may come back — not a count, not a
    // partial histogram.
    expect(dist.available).toBe(false);
    expect(dist.count).toBe(0);
    expect(dist.buckets).toHaveLength(0);
  });

  it('lists terms with and without population', async () => {
    const shells = await api.listTerms();
    expect(shells.every((t) => t.courses.length === 0)).toBe(true);

    const full = await api.listTerms({ populate: true });
    expect(full.find((t) => t.id === termId)!.courses.length).toBeGreaterThan(0);
  });

  it('rolls over to a new term, cloning shells without marks', async () => {
    const next = await api.rolloverTerm(termId, 'Integration Term 2', '2026-05-01', true);
    expect(next.isCurrent).toBe(true);
    expect(next.courses.length).toBeGreaterThan(0);
    // Carrying marks forward would corrupt the new term's average.
    expect(next.courses.every((c) => c.assessments.every((a) => a.grade === null))).toBe(true);

    // Exactly one current term — enforced by a partial unique index.
    const terms = await api.listTerms();
    expect(terms.filter((t) => t.isCurrent)).toHaveLength(1);
  });

  it('matches a pasted schedule against the real catalog', async () => {
    const match = await api.matchPastedSchedule(
      'Integration Term\nINT 101 - Integration Course\n  1234 LEC 001',
      'Integration Term',
    );
    expect(match.matched.some((m) => m.code === 'INT 101')).toBe(true);
  });

  it('submits feedback', async () => {
    await expect(
      api.submitFeedback({ category: 'bug', message: 'integration test', pageUrl: '/test' }),
    ).resolves.toBeUndefined();
  });

  it('rejects empty feedback before it reaches the database', async () => {
    await expect(api.submitFeedback({ category: 'bug', message: '   ' })).rejects.toMatchObject({
      code: 'validation/invalid-input',
    });
  });

  it('exports every row the user owns', async () => {
    const blob = await api.exportMyData();
    const text = await blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.profile).not.toBeNull();
    expect(Array.isArray(parsed.terms)).toBe(true);
    expect(text).toContain('INT 101');
  });

  it('rejects a non-UW email at signup', async () => {
    await expect(api.signUp('outsider@gmail.com', 'test-password-z1!')).rejects.toMatchObject({
      code: 'auth/invalid-email',
    });
  });
});

if (!configured) {
  describe('liveApi against a real database', () => {
    it.skip('needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY', () => {});
  });
}
