/**
 * Live implementation of the data-access contract — specs/04, backed by Supabase.
 *
 * Two rules hold throughout:
 *   1. RLS does the protecting. Nothing here filters by user_id defensively; the policies in
 *      07_rls.sql are the guarantee, and duplicating them in TypeScript would create a second
 *      place for the rule to be wrong.
 *   2. Every Postgres error goes through toApiError, so the UI only ever sees the shared
 *      vocabulary from specs/04 §7.
 */

import { computeCourse } from '@goosegrade/engine';

import { ApiError, API_ERROR_CODES, toApiError } from '../errors';
import { harvestCourseCodes, inferTerm, normalizeCode, termForDate } from '../parseSchedule';
import type {
  AssessmentPatch,
  CatalogCourseDetail,
  CatalogCourseSummary,
  CoursePatch,
  DistributionResult,
  GooseGradeApi,
  NewAssessmentInput,
  NewCourseInput,
  ScheduleMatch,
} from '../types';
import { getClient } from './client';
import {
  COURSE_SELECT,
  TERM_SELECT,
  toAssessment,
  toCatalogSummary,
  toCourse,
  toProfile,
  toTerm,
  type AssessmentRow,
  type CatalogCourseRow,
  type CourseRow,
  type ProfileRow,
  type TermRow,
} from './mappers';

const UW_EMAIL = /@uwaterloo\.ca$/i;

function assertUwEmail(email: string): void {
  if (!UW_EMAIL.test(email.trim())) {
    throw new ApiError(
      API_ERROR_CODES.invalidEmail,
      'Use your @uwaterloo.ca email address.',
    );
  }
}

/** Unwrap a PostgREST result, converting its error into the shared vocabulary. */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toApiError(result.error);
  if (result.data == null) {
    throw new ApiError(API_ERROR_CODES.notFound, 'Not found.');
  }
  return result.data;
}

async function requireUserId(): Promise<string> {
  const { data } = await getClient().auth.getUser();
  if (!data.user) {
    throw new ApiError(API_ERROR_CODES.unauthorized, 'You are not signed in.');
  }
  return data.user.id;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'item'
  );
}

export const liveApi: GooseGradeApi = {
  // ---- Auth & profile ------------------------------------------------------
  async signUp(email, password) {
    // Gated here AND by a database check, per specs/01. Client-side validation is for the
    // error message; the server-side check is the actual control.
    assertUwEmail(email);
    const { error } = await getClient().auth.signUp({ email, password });
    if (error) throw toApiError(error);
  },

  async signIn(email, password) {
    assertUwEmail(email);
    const { error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw toApiError(error);
  },

  async signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw toApiError(error);
  },

  async sendPasswordReset(email) {
    assertUwEmail(email);
    const { error } = await getClient().auth.resetPasswordForEmail(email);
    if (error) throw toApiError(error);
  },

  async getSession() {
    const { data } = await getClient().auth.getUser();
    if (!data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? '' };
  },

  async getProfile() {
    const userId = await requireUserId();
    const row = unwrap<ProfileRow>(
      await getClient()
        .from('profiles')
        .select('id, email, display_name, faculty, program, current_level, settings')
        .eq('id', userId)
        .single(),
    );
    return toProfile(row);
  },

  async updateProfile(patch) {
    const userId = await requireUserId();

    const update: Record<string, unknown> = {};
    if ('displayName' in patch) update.display_name = patch.displayName;
    if ('faculty' in patch) update.faculty = patch.faculty;
    if ('program' in patch) update.program = patch.program;
    if ('currentLevel' in patch) update.current_level = patch.currentLevel;
    if ('settings' in patch) update.settings = patch.settings;

    const row = unwrap<ProfileRow>(
      await getClient()
        .from('profiles')
        .update(update)
        .eq('id', userId)
        .select('id, email, display_name, faculty, program, current_level, settings')
        .single(),
    );
    return toProfile(row);
  },

  async deleteAccount() {
    // SECURITY DEFINER RPC: deletes the auth user, which cascades every user row including
    // this person's shared_grades. That cascade is what makes the deletion promise honest.
    const { error } = await getClient().rpc('delete_account');
    if (error) throw toApiError(error);
    await getClient().auth.signOut();
  },

  async exportMyData() {
    await requireUserId();
    const db = getClient();

    const [profile, terms] = await Promise.all([
      db.from('profiles').select('*').single(),
      db.from('user_terms').select(TERM_SELECT).order('term_date', { ascending: false }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      profile: profile.data ?? null,
      terms: terms.data ?? [],
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  },

  // ---- Catalog (public) ---------------------------------------------------
  async searchCatalog(query, limit = 10) {
    const normalized = normalizeCode(query);
    const raw = query.trim();
    if (raw.length < 2) return [];

    const rows = await getClient()
      .from('catalog_courses')
      .select('id, code, name, term, section, credit_weight, scheme_confidence')
      // Match the spaced form, the unspaced form the student typed, and the title.
      .or(`code.ilike.%${normalized}%,code.ilike.%${raw}%,name.ilike.%${raw}%`)
      .order('term_date', { ascending: false })
      .limit(limit);

    if (rows.error) throw toApiError(rows.error);
    return (rows.data as CatalogCourseRow[]).map(toCatalogSummary);
  },

  async getCatalogCourse(code, term) {
    let q = getClient()
      .from('catalog_courses')
      .select(
        `id, code, name, term, section, credit_weight, scheme_confidence, grade_basis,
         grading_rules, outline_url,
         catalog_assessments ( id, slug, name, category, assessment_type, weight, order_index )`,
      )
      .eq('code', normalizeCode(code));

    if (term) q = q.eq('term', term);

    const rows = await q.order('term_date', { ascending: false });
    if (rows.error) throw toApiError(rows.error);

    return (rows.data ?? []).map((row: Record<string, unknown>): CatalogCourseDetail => {
      const assessments = (row.catalog_assessments ?? []) as Array<
        Omit<AssessmentRow, 'grade' | 'status' | 'is_custom' | 'is_removed'>
      >;
      return {
        ...toCatalogSummary(row as unknown as CatalogCourseRow),
        gradeBasis: (row.grade_basis as CatalogCourseDetail['gradeBasis']) ?? 'numeric',
        gradingRules: (row.grading_rules as CatalogCourseDetail['gradingRules']) ?? [],
        // A catalog assessment carries no marks — it is a template.
        assessments: assessments
          .map((a) =>
            toAssessment({
              ...a,
              grade: null,
              status: 'upcoming',
              is_custom: false,
              is_removed: false,
            } as AssessmentRow),
          )
          .sort((x, y) => x.orderIndex - y.orderIndex),
        outlineUrl: (row.outline_url as string | null) ?? null,
      };
    });
  },

  async matchPastedSchedule(pastedText, term) {
    const candidates = harvestCourseCodes(pastedText);

    const inferred = inferTerm(pastedText);
    const resolvedTerm = term ?? inferred ?? termForDate(new Date());
    const termInferredFrom: ScheduleMatch['termInferredFrom'] = term
      ? 'caller'
      : inferred
        ? 'pasted_text'
        : 'current_date';

    if (candidates.length === 0) {
      return { term: resolvedTerm, termInferredFrom, matched: [], unmatched: [] };
    }

    // One query for every candidate, rather than N round trips.
    const rows = await getClient()
      .from('catalog_courses')
      .select('id, code, name, term, section, credit_weight, scheme_confidence')
      .in(
        'code',
        candidates.map((c) => c.code),
      )
      .eq('term', resolvedTerm);

    if (rows.error) throw toApiError(rows.error);

    const byCode = new Map<string, CatalogCourseSummary[]>();
    for (const row of (rows.data ?? []) as CatalogCourseRow[]) {
      const list = byCode.get(row.code) ?? [];
      list.push(toCatalogSummary(row));
      byCode.set(row.code, list);
    }

    const matched: ScheduleMatch['matched'] = [];
    const unmatched: string[] = [];

    for (const candidate of candidates) {
      const sections = byCode.get(candidate.code);
      if (!sections || sections.length === 0) {
        unmatched.push(candidate.code);
        continue;
      }
      // A section hint from the paste floats the right section to the top, so the common
      // case needs no interaction.
      const ordered = candidate.sectionHint
        ? [...sections].sort((a, b) =>
            a.section === candidate.sectionHint ? -1 : b.section === candidate.sectionHint ? 1 : 0,
          )
        : sections;
      matched.push({ code: candidate.code, sections: ordered });
    }

    return { term: resolvedTerm, termInferredFrom, matched, unmatched };
  },

  async getOutlineSource(catalogCourseId) {
    const row = await getClient()
      .from('catalog_courses')
      .select('outline_url, outline_storage_path, last_scraped')
      .eq('id', catalogCourseId)
      .maybeSingle();

    if (row.error) throw toApiError(row.error);
    if (!row.data) return null;

    const data = row.data as {
      outline_url: string | null;
      outline_storage_path: string | null;
      last_scraped: string | null;
    };

    // Prefer the stored copy: the live URL can change or vanish, and the stored one is what
    // the extraction actually read — which is the point of offering a source link at all.
    if (data.outline_storage_path) {
      const signed = await getClient()
        .storage.from('outlines')
        .createSignedUrl(data.outline_storage_path, 60 * 60);
      if (signed.data?.signedUrl) {
        return { url: signed.data.signedUrl, scrapedAt: data.last_scraped ?? '' };
      }
    }

    if (!data.outline_url) return null;
    return { url: data.outline_url, scrapedAt: data.last_scraped ?? '' };
  },

  // ---- Terms --------------------------------------------------------------
  async listTerms(opts) {
    await requireUserId();
    // populate:false returns shells for a term picker; true is needed by computeCumulative.
    const select = opts?.populate ? TERM_SELECT : 'id, term_label, term_date, is_current';
    const rows = await getClient()
      .from('user_terms')
      .select(select)
      .order('term_date', { ascending: false });

    if (rows.error) throw toApiError(rows.error);
    return (rows.data as unknown as TermRow[]).map(toTerm);
  },

  async getCurrentTerm() {
    await requireUserId();
    const row = await getClient()
      .from('user_terms')
      .select(TERM_SELECT)
      .eq('is_current', true)
      .maybeSingle();

    if (row.error) throw toApiError(row.error);
    return row.data ? toTerm(row.data as unknown as TermRow) : null;
  },

  async createTerm(label, termDate) {
    const userId = await requireUserId();
    const db = getClient();

    // A partial unique index enforces one current term per user, so clear the flag first.
    await db.from('user_terms').update({ is_current: false }).eq('is_current', true);

    const row = unwrap<TermRow>(
      await db
        .from('user_terms')
        .insert({ user_id: userId, term_label: label, term_date: termDate, is_current: true })
        .select('id, term_label, term_date, is_current')
        .single(),
    );
    return toTerm(row);
  },

  async setCurrentTerm(termId) {
    await requireUserId();
    const db = getClient();
    await db.from('user_terms').update({ is_current: false }).eq('is_current', true);
    const { error } = await db.from('user_terms').update({ is_current: true }).eq('id', termId);
    if (error) throw toApiError(error);
  },

  async rolloverTerm(fromTermId, newLabel, newTermDate, cloneCourses) {
    await requireUserId();
    const { data, error } = await getClient().rpc('rollover_term', {
      p_from_term_id: fromTermId,
      p_new_label: newLabel,
      p_new_term_date: newTermDate,
      p_clone_courses: cloneCourses,
    });
    if (error) throw toApiError(error);

    const row = unwrap<TermRow>(
      await getClient().from('user_terms').select(TERM_SELECT).eq('id', data).single(),
    );
    return toTerm(row);
  },

  // ---- Courses ------------------------------------------------------------
  async addCourseFromCatalog(catalogCourseId, termId) {
    await requireUserId();
    // Atomic fork in one RPC — the fix for the v1 shared-catalog bug.
    const { data, error } = await getClient().rpc('fork_catalog_course', {
      p_catalog_course_id: catalogCourseId,
      p_user_term_id: termId,
    });
    if (error) throw toApiError(error);

    const row = unwrap<CourseRow>(
      await getClient().from('user_courses').select(COURSE_SELECT).eq('id', data).single(),
    );
    return toCourse(row);
  },

  async addCustomCourse(termId, input: NewCourseInput) {
    const userId = await requireUserId();
    const row = unwrap<CourseRow>(
      await getClient()
        .from('user_courses')
        .insert({
          user_id: userId,
          user_term_id: termId,
          catalog_course_id: null,
          code: normalizeCode(input.code),
          name: input.name,
          section: input.section ?? null,
          credit_weight: input.creditWeight ?? 0.5,
          grade_basis: input.gradeBasis ?? 'numeric',
          grading_rules: input.gradingRules ?? [],
        })
        .select(COURSE_SELECT)
        .single(),
    );
    return toCourse(row);
  },

  async getCourse(courseId) {
    await requireUserId();
    const row = unwrap<CourseRow>(
      await getClient().from('user_courses').select(COURSE_SELECT).eq('id', courseId).single(),
    );
    return toCourse(row);
  },

  async updateCourse(courseId, patch: CoursePatch) {
    await requireUserId();

    const update: Record<string, unknown> = {};
    if ('name' in patch) update.name = patch.name;
    if ('code' in patch) update.code = patch.code;
    if ('section' in patch) update.section = patch.section;
    if ('creditWeight' in patch) update.credit_weight = patch.creditWeight;
    if ('gradeBasis' in patch) update.grade_basis = patch.gradeBasis;
    if ('targetGrade' in patch) update.target_grade = patch.targetGrade;
    if ('gradingRules' in patch) {
      update.grading_rules = patch.gradingRules;
      // Editing rules is what marks the fork as overridden, which is what "reset to
      // official" keys on. Setting it here rather than in the UI means every path that
      // edits rules gets it right.
      update.rules_overridden = true;
    }

    const row = unwrap<CourseRow>(
      await getClient()
        .from('user_courses')
        .update(update)
        .eq('id', courseId)
        .select(COURSE_SELECT)
        .single(),
    );
    return toCourse(row);
  },

  async resetCourseToCatalog(courseId) {
    await requireUserId();
    const { error } = await getClient().rpc('reset_course_to_catalog', {
      p_user_course_id: courseId,
    });
    if (error) throw toApiError(error);

    const row = unwrap<CourseRow>(
      await getClient().from('user_courses').select(COURSE_SELECT).eq('id', courseId).single(),
    );
    return toCourse(row);
  },

  async removeCourse(courseId) {
    await requireUserId();
    const { error } = await getClient().from('user_courses').delete().eq('id', courseId);
    if (error) throw toApiError(error);
  },

  // ---- Assessments --------------------------------------------------------
  async addAssessment(courseId, input: NewAssessmentInput) {
    const userId = await requireUserId();
    const db = getClient();

    // Slug uniqueness is per course, enforced by a unique index. Read the existing slugs so
    // a duplicate name gets a suffix instead of a constraint violation.
    const existing = await db
      .from('user_assessments')
      .select('slug, order_index')
      .eq('user_course_id', courseId);
    if (existing.error) throw toApiError(existing.error);

    const taken = new Set((existing.data ?? []).map((r) => (r as { slug: string }).slug));
    const base = slugify(input.name);
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;

    const maxOrder = (existing.data ?? []).reduce(
      (m, r) => Math.max(m, (r as { order_index: number }).order_index),
      0,
    );

    const row = unwrap<AssessmentRow>(
      await db
        .from('user_assessments')
        .insert({
          user_id: userId,
          user_course_id: courseId,
          catalog_assessment_id: null,
          slug,
          name: input.name,
          category: input.category ?? null,
          assessment_type: input.assessmentType ?? input.category ?? 'Other',
          weight: input.weight,
          order_index: input.orderIndex ?? maxOrder + 1,
          status: 'upcoming',
          is_custom: true,
        })
        .select(
          'id, slug, name, category, assessment_type, weight, order_index, grade, status, is_custom, is_removed',
        )
        .single(),
    );
    return toAssessment(row);
  },

  async updateAssessment(assessmentId, patch: AssessmentPatch) {
    await requireUserId();

    const update: Record<string, unknown> = {};
    if ('name' in patch) update.name = patch.name;
    if ('category' in patch) update.category = patch.category;
    if ('assessmentType' in patch) update.assessment_type = patch.assessmentType;
    if ('weight' in patch) update.weight = patch.weight;
    if ('orderIndex' in patch) update.order_index = patch.orderIndex;
    if ('grade' in patch) update.grade = patch.grade;
    if ('status' in patch) update.status = patch.status;
    if ('isRemoved' in patch) update.is_removed = patch.isRemoved;

    const row = unwrap<AssessmentRow>(
      await getClient()
        .from('user_assessments')
        .update(update)
        .eq('id', assessmentId)
        .select(
          'id, slug, name, category, assessment_type, weight, order_index, grade, status, is_custom, is_removed',
        )
        .single(),
    );
    return toAssessment(row);
  },

  async reorderAssessments(courseId, orderedIds) {
    await requireUserId();
    const db = getClient();
    // Sequential rather than a bulk upsert: an upsert would need every NOT NULL column, and
    // getting one wrong would overwrite a student's marks.
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await db
        .from('user_assessments')
        .update({ order_index: index + 1 })
        .eq('id', id)
        .eq('user_course_id', courseId);
      if (error) throw toApiError(error);
    }
  },

  async removeAssessment(assessmentId) {
    await requireUserId();
    // Soft-remove: keeps slug and catalog reference so reset-to-official can restore it.
    const { error } = await getClient()
      .from('user_assessments')
      .update({ is_removed: true })
      .eq('id', assessmentId);
    if (error) throw toApiError(error);
  },

  async setGrade(assessmentId, grade) {
    await requireUserId();

    if (grade != null && (grade < 0 || grade > 150)) {
      throw new ApiError(API_ERROR_CODES.invalidInput, 'Enter a mark between 0 and 150.');
    }

    const row = unwrap<AssessmentRow & { user_course_id: string }>(
      await getClient()
        .from('user_assessments')
        .update({
          grade,
          // Clearing a mark returns the item to upcoming rather than leaving a
          // graded-with-no-mark row the engine would have to warn about.
          status: grade == null ? 'upcoming' : 'graded',
        })
        .eq('id', assessmentId)
        .select(
          'id, user_course_id, slug, name, category, assessment_type, weight, order_index, grade, status, is_custom, is_removed',
        )
        .single(),
    );

    const courseRow = unwrap<CourseRow>(
      await getClient()
        .from('user_courses')
        .select(COURSE_SELECT)
        .eq('id', row.user_course_id)
        .single(),
    );

    // The UI has already recomputed optimistically; this is the verification copy.
    return { assessment: toAssessment(row), result: computeCourse(toCourse(courseRow)) };
  },

  // ---- Distributions ------------------------------------------------------
  async contributeGrades(courseId) {
    const userId = await requireUserId();
    const db = getClient();

    const profile = await this.getProfile();
    if (!profile.settings.contributeDistributions) {
      throw new ApiError(
        API_ERROR_CODES.notOptedIn,
        'Turn on contributing in Settings to see class distributions.',
      );
    }

    const course = await this.getCourse(courseId);
    if (!course.catalogCourseId) {
      throw new ApiError(
        API_ERROR_CODES.invalidInput,
        'Custom courses have no catalog counterpart to contribute to.',
      );
    }

    const termRow = await db
      .from('user_courses')
      .select('user_terms ( term_label )')
      .eq('id', courseId)
      .single();
    if (termRow.error) throw toApiError(termRow.error);
    const term =
      (termRow.data as { user_terms?: { term_label?: string } | null })?.user_terms?.term_label ??
      '';

    // Amendment A5: keyed on (catalog_course_id, slug), so a renamed item still contributes.
    const catalogSlugs = new Set<string>();
    const catalogRows = await db
      .from('catalog_assessments')
      .select('slug')
      .eq('course_id', course.catalogCourseId);
    if (catalogRows.error) throw toApiError(catalogRows.error);
    for (const r of catalogRows.data ?? []) catalogSlugs.add((r as { slug: string }).slug);

    const skipped: Array<{
      slug: string;
      reason: 'custom' | 'slug_not_in_catalog' | 'not_graded';
    }> = [];
    const rows: Array<Record<string, unknown>> = [];

    for (const a of course.assessments) {
      if (a.isRemoved) continue;
      if (a.isCustom) {
        skipped.push({ slug: a.slug, reason: 'custom' });
      } else if (!catalogSlugs.has(a.slug)) {
        skipped.push({ slug: a.slug, reason: 'slug_not_in_catalog' });
      } else if (a.status !== 'graded' || a.grade == null) {
        skipped.push({ slug: a.slug, reason: 'not_graded' });
      } else {
        rows.push({
          contributor_id: userId,
          catalog_course_id: course.catalogCourseId,
          slug: a.slug,
          term,
          grade: a.grade,
        });
      }
    }

    if (rows.length > 0) {
      const { error } = await db
        .from('shared_grades')
        .upsert(rows, { onConflict: 'contributor_id,catalog_course_id,slug,term' });
      if (error) throw toApiError(error);
    }

    return { contributed: rows.length, skipped };
  },

  async getCourseDistribution(catalogCourseId, term) {
    return callDistribution(catalogCourseId, null, term);
  },

  async getAssessmentDistribution(catalogCourseId, slug, term) {
    return callDistribution(catalogCourseId, slug, term);
  },

  // ---- Feedback -----------------------------------------------------------
  async submitFeedback(input) {
    if (input.message.trim().length === 0) {
      throw new ApiError(API_ERROR_CODES.invalidInput, 'Add a message before submitting.');
    }

    // Anonymous submission is allowed on purpose — the people most likely to report bad
    // course data are the ones who have not signed up yet.
    const { data } = await getClient().auth.getUser();

    const { error } = await getClient().from('feedback').insert({
      user_id: data.user?.id ?? null,
      category: input.category,
      message: input.message,
      page_url: input.pageUrl ?? null,
    });
    if (error) throw toApiError(error);
  },
};

/**
 * The only read path into shared_grades. The minimum-sample floor is enforced inside the
 * SECURITY DEFINER function, so this cannot leak an individual's mark even if called wrongly.
 */
async function callDistribution(
  catalogCourseId: string,
  slug: string | null,
  term: string,
): Promise<DistributionResult> {
  const { data, error } = await getClient().rpc('get_distribution', {
    p_catalog_course_id: catalogCourseId,
    p_slug: slug,
    p_term: term,
  });
  if (error) throw toApiError(error);

  const raw = (data ?? {}) as Partial<DistributionResult>;
  return {
    available: raw.available === true,
    count: raw.count ?? 0,
    mean: raw.mean ?? 0,
    median: raw.median ?? 0,
    buckets: raw.buckets ?? [],
    myPercentile: raw.myPercentile ?? null,
    term,
  };
}
