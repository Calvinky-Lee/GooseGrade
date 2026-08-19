'use client';

/**
 * The shared grade table — the piece that kills the legacy duplication.
 *
 * specs/00 lists "refactor of the legacy 1,800-line duplication into shared engine +
 * components" as Phase 1 work. v1 had the same grouping, weight-editing and calculation logic
 * written twice: once in app/course/[code]/page.tsx (1,821 lines) and again in
 * app/calculator/page.tsx (1,170). Both are replaced by this component plus @goosegrade/engine.
 *
 * It is deliberately state-agnostic: the caller owns the Course and decides whether edits
 * persist. That is what lets the same table serve the signed-out calculator (ephemeral), the
 * signed-out course preview (catalog-seeded, ephemeral), and — in principle — the signed-in
 * course page.
 */

import { computeCourse, groupAssessments, requiredForCourse } from '@goosegrade/engine';
import type { Assessment, AssessmentStatus, Course } from '@goosegrade/types';

import { Num } from '@/app/dashboard/Num';

export interface GradeTableProps {
  course: Course;
  onChange: (course: Course) => void;
  /** Weights are editable in the calculator, fixed when previewing an official scheme. */
  editableWeights?: boolean;
  /** Status control is only meaningful where excused/missed can be recorded. */
  showStatus?: boolean;
  onAddRow?: () => void;
}

export function GradeTable({
  course,
  onChange,
  editableWeights = false,
  showStatus = true,
  onAddRow,
}: GradeTableProps) {
  const items = groupAssessments(course.assessments);

  const patch = (id: string, update: Partial<Assessment>) =>
    onChange({
      ...course,
      assessments: course.assessments.map((a) => (a.id === id ? { ...a, ...update } : a)),
    });

  const setGrade = (a: Assessment, raw: string) => {
    const trimmed = raw.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value != null && !Number.isFinite(value)) return;
    // Clearing a mark returns the row to upcoming rather than leaving a graded-with-no-mark
    // row the engine would have to warn about.
    patch(a.id, { grade: value, status: value == null ? 'upcoming' : 'graded' });
  };

  const setWeight = (a: Assessment, raw: string) => {
    const value = Number(raw.trim());
    if (!Number.isFinite(value) || value < 0) return;
    patch(a.id, { weight: value });
  };

  const remove = (a: Assessment) => patch(a.id, { isRemoved: true });

  const cols = editableWeights
    ? '1fr 76px 76px 116px 40px'
    : showStatus
      ? '1fr 76px 116px'
      : '1fr 76px';

  return (
    <div className="gg-panel">
      {course.assessments.filter((a) => !a.isRemoved).length === 0 && (
        <div className="gg-hint">No assessments yet.</div>
      )}

      {items.map((item) =>
        item.isGroup ? (
          <div key={item.id}>
            <div className="gg-row" style={{ gridTemplateColumns: cols, borderBottom: 0, paddingBottom: 2 }}>
              <div>
                <div className="label">{item.name}</div>
                <div className="sub">
                  {item.children.length} items · <Num value={item.weight} decimals={2} /> total
                </div>
              </div>
            </div>
            {item.children.map((child) => (
              <Row
                key={child.id}
                assessment={child}
                cols={cols}
                indent
                editableWeights={editableWeights}
                showStatus={showStatus}
                onGrade={setGrade}
                onWeight={setWeight}
                onStatus={(a, status) =>
                  patch(a.id, { status, grade: status === 'graded' ? a.grade : null })
                }
                onRemove={editableWeights ? remove : undefined}
              />
            ))}
          </div>
        ) : (
          <Row
            key={item.id}
            assessment={item.assessment}
            cols={cols}
            editableWeights={editableWeights}
            showStatus={showStatus}
            onGrade={setGrade}
            onWeight={setWeight}
            onStatus={(a, status) =>
              patch(a.id, { status, grade: status === 'graded' ? a.grade : null })
            }
            onRemove={editableWeights ? remove : undefined}
          />
        ),
      )}

      {onAddRow && (
        <button
          type="button"
          className="gg-link"
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: '10px 0 0' }}
          onClick={onAddRow}
        >
          + add an assessment
        </button>
      )}
    </div>
  );
}

function Row({
  assessment,
  cols,
  indent = false,
  editableWeights,
  showStatus,
  onGrade,
  onWeight,
  onStatus,
  onRemove,
}: {
  assessment: Assessment;
  cols: string;
  indent?: boolean;
  editableWeights: boolean;
  showStatus: boolean;
  onGrade: (a: Assessment, raw: string) => void;
  onWeight: (a: Assessment, raw: string) => void;
  onStatus: (a: Assessment, status: AssessmentStatus) => void;
  onRemove?: (a: Assessment) => void;
}) {
  return (
    <div className="gg-row" style={{ gridTemplateColumns: cols }}>
      <div style={{ paddingLeft: indent ? 14 : 0 }}>
        <div className="label">{assessment.name}</div>
        {!editableWeights && (
          <div className="sub">
            <Num value={assessment.weight} decimals={2} /> of course
          </div>
        )}
      </div>

      <input
        className="gg-input"
        value={assessment.grade ?? ''}
        onChange={(e) => onGrade(assessment, e.target.value)}
        disabled={assessment.status === 'excused' || assessment.status === 'missed'}
        inputMode="decimal"
        placeholder="—"
        aria-label={`mark for ${assessment.name}`}
      />

      {editableWeights && (
        <input
          className="gg-input"
          value={assessment.weight}
          onChange={(e) => onWeight(assessment, e.target.value)}
          inputMode="decimal"
          aria-label={`weight for ${assessment.name}`}
        />
      )}

      {showStatus && (
        <select
          className="gg-select"
          value={assessment.status}
          onChange={(e) => onStatus(assessment, e.target.value as AssessmentStatus)}
          aria-label={`status for ${assessment.name}`}
        >
          <option value="upcoming">Upcoming</option>
          <option value="graded">Graded</option>
          <option value="excused">Excused</option>
          <option value="missed">Missed</option>
        </select>
      )}

      {onRemove && (
        <button
          type="button"
          className="gg-link"
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          onClick={() => onRemove(assessment)}
          aria-label={`remove ${assessment.name}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The summary block above the table. Shared for the same reason: v1 computed these figures
 * separately on each page, which is how two screens end up disagreeing about a grade.
 */
export function GradeSummary({
  course,
  target,
  onTargetChange,
}: {
  course: Course;
  target: string;
  onTargetChange: (value: string) => void;
}) {
  const result = computeCourse(course);
  const targetNum = Number(target);
  const required =
    target !== '' && Number.isFinite(targetNum) ? requiredForCourse(course, targetNum) : null;

  return (
    <>
      <section className="gg-hero">
        <div>
          <div className="gg-eyebrow">Current grade</div>
          <div className="gg-heroval">
            <Num value={result.currentGrade} />
          </div>
          <div className="gg-heronote">
            <Num value={result.completedWeight} decimals={0} /> graded ·{' '}
            <Num value={result.remainingWeight} decimals={0} /> remaining
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

          {result.passGateStatus !== 'n/a' && (
            <div className="gg-mini">
              <div className="gg-eyebrow">Pass requirement</div>
              <div className="v" style={{ fontSize: '1.05rem' }}>
                <span className={`gg-chip ${result.passGateStatus === 'ok' ? 'good' : 'risk'}`}>
                  <span className="d" />
                  {result.passGateStatus === 'ok'
                    ? 'Met'
                    : result.passGateStatus === 'failed'
                      ? 'Not met'
                      : 'Outstanding'}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="gg-need">
        <span>I want</span>
        <span className="gg-field">
          <input
            value={target}
            onChange={(e) => onTargetChange(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            aria-label="target grade"
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

      {result.appliedRules.length > 0 && (
        <>
          <div className="gg-seclabel">
            <h2>Rules applied</h2>
            <span>from the official outline</span>
          </div>
          <div className="gg-panel">
            {result.appliedRules.map((r) => (
              <div key={`${r.ruleId}-${r.effect}`} className="gg-rule">
                <span style={{ flex: 1 }}>
                  {r.description || r.type}
                  <div className="gg-hint">{r.effect}</div>
                </span>
                <span className="gg-tag">{r.type}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
