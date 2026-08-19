'use client';

/**
 * Course detail — specs/06 F3.1–F3.4.
 *
 * This is the grade-back loop. Typing a mark recomputes everything through the pure engine
 * synchronously, then persists via setGrade in the background. The number moves before the
 * network call resolves, which is what makes the <5s target trivially met.
 */

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';

import { api } from '@goosegrade/api';
import { computeCourse, groupAssessments, requiredForCourse } from '@goosegrade/engine';
import type {
  Assessment,
  AssessmentStatus,
  Course,
  GradingRule,
  RedistributeRule,
} from '@goosegrade/types';

import { FeedbackButton, TopBar } from '../../AppChrome';
import { Num } from '../../Num';
import { Distribution } from './Distribution';
import { MoveWeight } from './MoveWeight';

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a promise in Next 15+. In a Client Component the documented way to read it is
  // React's use() — resolving it in an effect would cost a render pass with a null id.
  const { id: courseId } = use(params);

  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('');
  // Distributions are per-term (never mixed across terms), so the panel needs the label.
  const [termLabel, setTermLabel] = useState<string>('');

  useEffect(() => {
    api.getCurrentTerm().then((t) => setTermLabel(t?.termLabel ?? ''));
  }, []);

  useEffect(() => {
    let cancelled = false;

    api
      .getCourse(courseId)
      .then((c) => {
        if (cancelled) return;
        setCourse(c);
        setTarget(c.targetGrade != null ? String(c.targetGrade) : '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const result = useMemo(() => (course ? computeCourse(course) : null), [course]);
  const items = useMemo(() => (course ? groupAssessments(course.assessments) : []), [course]);

  const targetNum = Number(target);
  const required = useMemo(
    () =>
      course && Number.isFinite(targetNum) && target !== ''
        ? requiredForCourse(course, targetNum)
        : null,
    [course, targetNum, target],
  );

  if (error) {
    return (
      <div className="gg-wrap">
        <BackLink />
        <div className="gg-panel">{error}</div>
      </div>
    );
  }

  if (!course || !result) {
    return (
      <div className="gg-wrap">
        <BackLink />
        <div className="gg-panel" aria-busy="true" style={{ minHeight: 120 }} />
      </div>
    );
  }

  /**
   * Optimistic local update, then persist. The engine is pure so the recompute is free; the
   * server response is only used to reconcile, per specs/04 §4.
   */
  const patchAssessment = (id: string, patch: Partial<Assessment>) => {
    setCourse((prev) =>
      prev
        ? {
            ...prev,
            assessments: prev.assessments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
          }
        : prev,
    );
  };

  const onGradeChange = (assessment: Assessment, raw: string) => {
    const trimmed = raw.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value != null && !Number.isFinite(value)) return;

    patchAssessment(assessment.id, {
      grade: value,
      // Clearing a mark returns the item to upcoming, rather than leaving a
      // graded-with-no-mark row the engine would have to warn about.
      status: value == null ? 'upcoming' : 'graded',
    });

    void api.setGrade(assessment.id, value).catch(() => {
      /* mock cannot fail; a live impl would reconcile or surface a toast here */
    });
  };

  const onStatusChange = (assessment: Assessment, status: AssessmentStatus) => {
    patchAssessment(assessment.id, {
      status,
      // Excused and missed both mean "no mark of my own", so clear any stale number.
      grade: status === 'graded' ? assessment.grade : null,
    });
    void api.updateAssessment(assessment.id, { status }).catch(() => {});
  };

  /** Persist a whole new rule array and mark the fork as overridden. */
  const writeRules = (gradingRules: GradingRule[]) => {
    setCourse((prev) => (prev ? { ...prev, gradingRules, rulesOverridden: true } : prev));
    void api.updateCourse(course.id, { gradingRules }).catch(() => {});
  };

  const addRule = (rule: RedistributeRule) => writeRules([...course.gradingRules, rule]);

  const removeRule = (ruleId: string) =>
    writeRules(course.gradingRules.filter((r) => r.id !== ruleId));

  const toggleRule = (ruleId: string) => {
    setCourse((prev) => {
      if (!prev) return prev;
      const gradingRules = prev.gradingRules.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
      );
      void api.updateCourse(prev.id, { gradingRules }).catch(() => {});
      // Editing rules is what sets rules_overridden, which is what "reset to official" keys on.
      return { ...prev, gradingRules, rulesOverridden: true };
    });
  };

  const flat = course.assessments.filter((a) => !a.isRemoved);

  return (
    <div className="gg-wrap">
      <TopBar right={<BackLink />} />

      <section className="gg-hero">
        <div>
          <div className="gg-eyebrow">
            {course.code}
            {course.section ? ` · ${course.section}` : ''}
          </div>
          <div className="gg-heroval">
            <Num value={result.currentGrade} />
          </div>
          <div className="gg-heronote">
            {course.name}
            {' · '}
            <Num value={result.completedWeight} decimals={0} /> graded
          </div>
        </div>

        <div className="gg-ministats">
          <div className="gg-mini">
            <div className="gg-eyebrow">Achievable range</div>
            <div className="v">
              <Num value={result.floor} decimals={0} unit={null} />–
              <Num value={result.ceiling} decimals={0} />
            </div>
            <div className="s">0% to 100% on what&apos;s left</div>
          </div>

          {/* The gate sits BESIDE the average, never in place of it. */}
          {result.passGateStatus !== 'n/a' && (
            <div className="gg-mini">
              <div className="gg-eyebrow">Pass requirement</div>
              <div className="v" style={{ fontSize: '1.05rem' }}>
                <span
                  className={`gg-chip ${result.passGateStatus === 'ok' ? 'good' : 'risk'}`}
                >
                  <span className="d" />
                  {result.passGateStatus === 'ok'
                    ? 'Met'
                    : result.passGateStatus === 'failed'
                      ? 'Not met'
                      : 'Outstanding'}
                </span>
              </div>
              <div className="s">shown alongside your average, never instead of it</div>
            </div>
          )}
        </div>
      </section>

      {/* Target calculator — F3.5 */}
      <div className="gg-need">
        <span>I want</span>
        <span className="gg-field">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            aria-label="target course grade"
            placeholder="80"
          />
          <span className="gg-u">%</span>
        </span>
        <span>{required ? required.message : 'in this course.'}</span>
      </div>

      {result.warnings.length > 0 && (
        <div className="gg-warn">
          {result.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="gg-seclabel">
        <h2>Assessments</h2>
        <span>enter a mark — everything recomputes as you type</span>
      </div>

      <div className="gg-panel">
        {flat.length === 0 && <div className="gg-hint">No assessments yet.</div>}

        {items.map((item) =>
          item.isGroup ? (
            <div key={item.id}>
              <div className="gg-row" style={{ borderBottom: 0, paddingBottom: 2 }}>
                <div>
                  <div className="label">{item.name}</div>
                  <div className="sub">
                    {item.children.length} items · <Num value={item.weight} decimals={2} /> total
                  </div>
                </div>
                <div />
                <div />
                <div />
              </div>
              {item.children.map((child) => (
                <AssessmentRow
                  key={child.id}
                  course={course}
                  assessment={child}
                  indent
                  onGradeChange={onGradeChange}
                  onStatusChange={onStatusChange}
                  onAddRule={addRule}
                />
              ))}
            </div>
          ) : (
            <AssessmentRow
              key={item.id}
              course={course}
              assessment={item.assessment}
              onGradeChange={onGradeChange}
              onStatusChange={onStatusChange}
              onAddRule={addRule}
            />
          ),
        )}
      </div>

      {/* Rules panel — F3.3 */}
      <div className="gg-seclabel">
        <h2>Grading rules</h2>
        <span>
          {course.gradingRules.filter((r) => r.source === 'scraped').length} official
          {course.gradingRules.some((r) => r.source === 'user')
            ? ` · ${course.gradingRules.filter((r) => r.source === 'user').length} yours`
            : ''}
        </span>
      </div>

      <div className="gg-panel">
        {course.gradingRules.length === 0 && (
          <div className="gg-hint">
            No special rules — this course is a plain weighted sum.
          </div>
        )}

        {course.gradingRules.map((rule) => (
          <label key={rule.id} className="gg-rule">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={() => toggleRule(rule.id)}
              style={{ marginTop: 3 }}
            />
            <span style={{ flex: 1 }}>
              {rule.description || rule.type}
              <div className="gg-hint">
                {result.appliedRules.find((a) => a.ruleId === rule.id)?.effect ??
                  (rule.enabled ? 'not currently affecting your grade' : 'disabled')}
              </div>
            </span>
            <span className={`gg-tag${rule.source === 'user' ? ' you' : ''}`}>
              {rule.source === 'user' ? 'you' : 'official'}
            </span>
            {/* Only user-authored rules can be deleted. An official rule can be switched off
                but not removed, since it is part of the course's real scheme. */}
            {rule.source === 'user' && (
              <button
                type="button"
                className="gg-link"
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                onClick={(e) => {
                  e.preventDefault();
                  removeRule(rule.id);
                }}
              >
                undo
              </button>
            )}
          </label>
        ))}

        {course.rulesOverridden && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="gg-link"
              style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
              onClick={() => {
                void api.resetCourseToCatalog(course.id).then(setCourse).catch(() => {});
              }}
            >
              Reset to official rules
            </button>
            <div className="gg-hint">Your entered marks are preserved.</div>
          </div>
        )}
      </div>

      {/* Show the math — F3.4 */}
      <div className="gg-seclabel">
        <h2>Show the math</h2>
        <span>what the engine did</span>
      </div>

      <div className="gg-panel">
        <div className="gg-rule" style={{ borderBottom: '1px solid var(--line)' }}>
          <span style={{ flex: 1 }}>
            Weighted sum over graded work
            <div className="gg-hint">
              <Num value={result.completedWeight} decimals={2} /> of the course is graded;
              remaining <Num value={result.remainingWeight} decimals={2} />
            </div>
          </span>
          <b className="gg-n">
            <Num value={result.currentGrade} />
          </b>
        </div>

        {result.appliedRules.length === 0 ? (
          <div className="gg-hint" style={{ paddingTop: 10 }}>
            No rules fired for your current marks.
          </div>
        ) : (
          result.appliedRules.map((applied) => (
            <div key={`${applied.ruleId}-${applied.effect}`} className="gg-rule">
              <span style={{ flex: 1 }}>
                {applied.description || applied.type}
                <div className="gg-hint">{applied.effect}</div>
              </span>
              <span className="gg-tag">{applied.type}</span>
            </div>
          ))
        )}
      </div>

      <Distribution
        catalogCourseId={course.catalogCourseId}
        slug={null}
        term={termLabel}
        label={`${course.code} overall`}
      />

      <FeedbackButton
        defaultCategory="course_data"
        contextNote={`Course: ${course.code}${course.section ? ` (${course.section})` : ''}`}
      />
    </div>
  );
}

function AssessmentRow({
  course,
  assessment,
  indent = false,
  onGradeChange,
  onStatusChange,
  onAddRule,
}: {
  course: Course;
  assessment: Assessment;
  indent?: boolean;
  onGradeChange: (a: Assessment, raw: string) => void;
  onStatusChange: (a: Assessment, status: AssessmentStatus) => void;
  onAddRule: (rule: RedistributeRule) => void;
}) {
  return (
    <div className="gg-row">
      <div style={{ paddingLeft: indent ? 14 : 0 }}>
        <div className="label">{assessment.name}</div>
        <div className="sub">
          <Num value={assessment.weight} decimals={2} /> of course
        </div>
      </div>

      <div>
        <input
          className="gg-input"
          value={assessment.grade ?? ''}
          onChange={(e) => onGradeChange(assessment, e.target.value)}
          disabled={assessment.status === 'excused' || assessment.status === 'missed'}
          inputMode="decimal"
          placeholder="—"
          aria-label={`mark for ${assessment.name}`}
        />
      </div>

      <div className="statuscell">
        <select
          className="gg-select"
          value={assessment.status}
          onChange={(e) => onStatusChange(assessment, e.target.value as AssessmentStatus)}
          aria-label={`status for ${assessment.name}`}
        >
          <option value="upcoming">Upcoming</option>
          <option value="graded">Graded</option>
          <option value="excused">Excused</option>
          <option value="missed">Missed</option>
        </select>
      </div>

      {/* The consequence is stated in place, because excused-vs-missed is the distinction that
          decides whether a student is shown as passing or failing. */}
      <div className="gg-hint" style={{ margin: 0 }}>
        {assessment.status === 'excused' && 'weight leaves your denominator'}
        {assessment.status === 'missed' && (
          <>
            counts as a zero
            <div style={{ marginTop: 4 }}>
              <MoveWeight course={course} assessment={assessment} onAddRule={onAddRule} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard" className="gg-termsel" style={{ textDecoration: 'none' }}>
      ← My Term
    </Link>
  );
}
