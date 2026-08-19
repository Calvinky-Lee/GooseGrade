'use client';

/**
 * My Term dashboard — specs/06 F2.1, F2.2, F2.3.
 *
 * The whole screen is derived. `getCurrentTerm()` returns one fully-populated payload and every
 * number here comes from the pure engine, recomputed on render. Nothing is stored, so nothing
 * can be stale — which is why the grade-back loop needs no cache invalidation.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@goosegrade/api';
import {
  computeCourse,
  computeCumulative,
  computeTermAverage,
  requiredAcrossCourses,
  requiredForCourse,
} from '@goosegrade/engine';
import type { Course, Term } from '@goosegrade/types';

import { FeedbackButton, TopBar } from './AppChrome';
import { Num } from './Num';

export default function DashboardPage() {
  const [term, setTerm] = useState<Term | null>(null);
  const [allTerms, setAllTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<string>('82');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // populate: true because computeCumulative needs every term's courses (amendment A1).
      const [current, terms] = await Promise.all([
        api.getCurrentTerm(),
        api.listTerms({ populate: true }),
      ]);
      if (cancelled) return;
      setTerm(current);
      setAllTerms(terms);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const courses = term?.courses ?? [];

  const termAvg = useMemo(() => computeTermAverage(courses), [courses]);
  const cumulative = useMemo(() => computeCumulative(allTerms), [allTerms]);

  const targetNum = Number(target);
  const crossCourse = useMemo(() => {
    if (!Number.isFinite(targetNum) || courses.length === 0) return null;
    return requiredAcrossCourses(courses, targetNum);
  }, [courses, targetNum]);

  if (loading) {
    return (
      <div className="gg-wrap">
        <TopBar />
        <div className="gg-hero" style={{ minHeight: 148 }} aria-busy="true" />
      </div>
    );
  }

  if (!term) {
    return (
      <div className="gg-wrap">
        <TopBar />
        <div className="gg-panel">
          <b>No current term yet.</b>
          <p className="gg-hint">Create a term to start tracking your courses.</p>
          <Link href="/dashboard/onboarding" className="gg-termsel" style={{ marginTop: 12, display: 'inline-block', textDecoration: 'none' }}>
            Set up my term
          </Link>
        </div>
      </div>
    );
  }

  const excludedCodes = termAvg.exclusions
    .map((e) => courses.find((c) => c.id === e.courseId)?.code)
    .filter(Boolean);

  return (
    <div className="gg-wrap">
      <TopBar
        right={
          <>
            <Link href="/dashboard/record" className="gg-termsel" style={{ textDecoration: 'none' }}>
              My record
            </Link>
            <span className="gg-termsel" aria-label="current term">
              {term.termLabel}
            </span>
          </>
        }
      />

      <section className="gg-hero">
        <div>
          <div className="gg-eyebrow">Term average</div>
          <div className="gg-heroval">
            <Num value={termAvg.average} />
          </div>
          <div className="gg-heronote">
            {termAvg.average == null ? (
              'No marks entered yet this term.'
            ) : (
              <>
                Projected{' '}
                <b>
                  <Num value={termAvg.projectedAverage} />
                </b>{' '}
                at your current pace · credit-weighted over{' '}
                {courses.length - termAvg.exclusions.length} course
                {courses.length - termAvg.exclusions.length === 1 ? '' : 's'}
              </>
            )}
          </div>
        </div>

        <div className="gg-ministats">
          <div className="gg-mini">
            <div className="gg-eyebrow">Cumulative</div>
            <div className="v">
              <Num value={cumulative.average} />
            </div>
            <div className="s">
              {cumulative.deltaVsPreviousTerm == null ? (
                'first term on record'
              ) : (
                <>
                  <span
                    className={cumulative.deltaVsPreviousTerm >= 0 ? 'gg-up' : 'gg-down'}
                  >
                    {cumulative.deltaVsPreviousTerm >= 0 ? '▲' : '▼'}&nbsp;
                    <Num value={Math.abs(cumulative.deltaVsPreviousTerm)} unit={null} />
                  </span>{' '}
                  vs last term
                </>
              )}
            </div>
          </div>

          <div className="gg-mini">
            <div className="gg-eyebrow">Credits</div>
            <div className="v">
              <Num value={termAvg.includedCredits} decimals={1} unit={null} />
            </div>
            <div className="s">
              {excludedCodes.length > 0 ? `${excludedCodes.join(', ')} excluded` : 'all counted'}
            </div>
          </div>
        </div>
      </section>

      {/* Cross-course "what do I need" — F2.3. Neutral wording, no coaching. */}
      <div className="gg-need">
        <span>Aim for</span>
        <span className="gg-field">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            aria-label="target term average"
          />
          <span className="gg-u">%</span>
        </span>
        <span>
          this term →{' '}
          {crossCourse && Number.isFinite(targetNum)
            ? crossCourse.message
            : 'enter a target.'}
        </span>
      </div>

      <div className="gg-seclabel">
        <h2>Courses</h2>
        <span>tap a course to enter grades</span>
      </div>

      <div className="gg-grid">
        {courses.map((course) => (
          <CourseCard key={course.id} course={course} />
        ))}

        <Link href="/dashboard/add" className="gg-card gg-add">
          <div className="plus" aria-hidden="true">
            +
          </div>
          <b>Add a course</b>
          <div className="s">paste your schedule or search</div>
        </Link>
      </div>

      <p className="gg-foot">
        Every figure on this page is computed live by <code>@goosegrade/engine</code> — nothing
        is stored, so nothing can be stale.
      </p>

      <FeedbackButton />
    </div>
  );
}

function CourseCard({ course }: { course: Course }) {
  const result = computeCourse(course);

  // CR/NCR courses are not in any average, so they show their basis instead of a number.
  if (course.gradeBasis === 'cr_ncr') {
    return (
      <Link href={`/dashboard/course/${course.id}`} className="gg-card gg-excluded">
        <div className="gg-ctop">
          <div>
            <div className="gg-code">{course.code}</div>
            <div className="gg-name">{course.name}</div>
          </div>
          <div className="gg-grade gg-empty">CR</div>
        </div>
        <div className="gg-cbottom">
          <span className="gg-chip muted">Credit / no-credit</span>
          <span className="gg-cap">not in average</span>
        </div>
      </Link>
    );
  }

  const target = course.targetGrade;
  const required = target != null ? requiredForCourse(course, target) : null;

  return (
    <Link href={`/dashboard/course/${course.id}`} className="gg-card">
      <div className="gg-ctop">
        <div>
          <div className="gg-code">{course.code}</div>
          <div className="gg-name">{course.name}</div>
        </div>
        <div className={`gg-grade${result.currentGrade == null ? ' gg-empty' : ''}`}>
          <Num value={result.currentGrade} />
        </div>
      </div>

      <div className="gg-bar">
        <i style={{ width: `${Math.min(100, result.completedWeight)}%` }} />
      </div>

      <div className="gg-cbottom">
        <StatusChip course={course} result={result} required={required} />
        <span className="gg-cap">{caption(result, target, required)}</span>
      </div>
    </Link>
  );
}

function StatusChip({
  result,
  required,
}: {
  course: Course;
  result: ReturnType<typeof computeCourse>;
  required: ReturnType<typeof requiredForCourse> | null;
}) {
  // A pass gate is surfaced as at-risk, but NEVER replaces the number — the average is
  // rendered right above this chip, always.
  if (result.passGateStatus === 'failed' || result.passGateStatus === 'at_risk') {
    return (
      <span className="gg-chip risk">
        <span className="d" />
        At risk
      </span>
    );
  }

  if (result.currentGrade == null) {
    return <span className="gg-chip muted">Not started</span>;
  }

  if (required && !required.feasible) {
    return (
      <span className="gg-chip risk">
        <span className="d" />
        Target unreachable
      </span>
    );
  }

  const aheadOfTarget = required != null && required.requiredAverage != null
    && result.currentGrade >= (required.requiredAverage ?? 0);

  return (
    <span className="gg-chip good">
      <span className="d" />
      {aheadOfTarget ? 'Ahead of target' : 'On track'}
    </span>
  );
}

function caption(
  result: ReturnType<typeof computeCourse>,
  target: number | null,
  required: ReturnType<typeof requiredForCourse> | null,
): string {
  if (result.passGateStatus === 'at_risk' || result.passGateStatus === 'failed') {
    const gate = result.appliedRules.find((r) => r.type === 'passGate');
    if (gate) return gate.effect;
  }

  const graded = `${Math.round(result.completedWeight)}% graded`;

  if (target != null && required?.requiredAverage != null && required.feasible) {
    return `${graded} · need ${required.requiredAverage.toFixed(0)}% for ${target}`;
  }

  if (target != null) return `${graded} · target ${target}`;
  return graded;
}
