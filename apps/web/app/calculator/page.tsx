'use client';

/**
 * The signed-out calculator — specs/00 (secondary audience), specs/04 §8.
 *
 * Replaces a 1,170-line page that reimplemented grade maths the engine now owns. Everything
 * here is the shared GradeTable plus @goosegrade/engine; this file is only the shell, the seed
 * data and the growth loop.
 *
 * Scratch by design: nothing persists, and the pitch to sign up is that the work carries over.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@goosegrade/api';
import type { Assessment, Course } from '@goosegrade/types';

import { GradeSummary, GradeTable } from '@/components/gg/GradeTable';

import '../dashboard/tokens.css';

let uid = 0;
const nextId = () => `scratch-${(uid += 1)}`;

function blankAssessment(name: string, weight: number, order: number): Assessment {
  return {
    id: nextId(),
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    category: null,
    assessmentType: 'Other',
    weight,
    orderIndex: order,
    grade: null,
    status: 'upcoming',
    isCustom: true,
    isRemoved: false,
  };
}

const BLANK: Course = {
  id: 'scratch',
  catalogCourseId: null,
  code: 'My course',
  name: 'Scratch calculator',
  section: null,
  creditWeight: 0.5,
  gradeBasis: 'numeric',
  gradingRules: [],
  rulesOverridden: false,
  targetGrade: null,
  assessments: [
    blankAssessment('Assignments', 30, 1),
    blankAssessment('Midterm', 30, 2),
    blankAssessment('Final Exam', 40, 3),
  ],
};

export default function CalculatorPage() {
  const [course, setCourse] = useState<Course>(BLANK);
  const [target, setTarget] = useState('80');
  const [signedIn, setSignedIn] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.getSession().then((s) => setSignedIn(s != null)).catch(() => setSignedIn(false));
  }, []);

  const addRow = () =>
    setCourse((c) => ({
      ...c,
      assessments: [
        ...c.assessments,
        blankAssessment(`Item ${c.assessments.length + 1}`, 0, c.assessments.length + 1),
      ],
    }));

  /**
   * The growth loop: a signed-in visitor can promote the scratch course into a real one in
   * their current term, marks and all. Without this the calculator is a dead end.
   */
  const saveToTerm = async () => {
    setSaveState('saving');
    setSaveError(null);
    try {
      const term = await api.getCurrentTerm();
      if (!term) {
        setSaveError('No current term yet — set one up first.');
        setSaveState('error');
        return;
      }

      const created = await api.addCustomCourse(term.id, {
        code: course.code,
        name: course.name === 'Scratch calculator' ? course.code : course.name,
        creditWeight: course.creditWeight,
      });

      for (const a of course.assessments.filter((x) => !x.isRemoved)) {
        const added = await api.addAssessment(created.id, {
          name: a.name,
          weight: a.weight,
          category: a.category ?? undefined,
        });
        if (a.grade != null) await api.setGrade(added.id, a.grade);
      }

      setSaveState('saved');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveState('error');
    }
  };

  return (
    <div className="gg-app">
      <div className="gg-wrap">
        <header className="gg-topbar">
          <Link href="/" className="gg-brand">
            <span className="gg-goose" aria-hidden="true" />
            <b>GooseGrade</b>
          </Link>
          <Link
            href={signedIn ? '/dashboard' : '/auth'}
            className="gg-termsel"
            style={{ textDecoration: 'none' }}
          >
            {signedIn ? 'My Term' : 'Sign in'}
          </Link>
        </header>

        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <input
            className="gg-textinput"
            style={{ maxWidth: 220, fontWeight: 650 }}
            value={course.code}
            onChange={(e) => setCourse((c) => ({ ...c, code: e.target.value }))}
            aria-label="course name"
          />
          <span className="gg-hint" style={{ margin: 0 }}>
            no account needed — nothing is saved
          </span>
        </div>

        <div style={{ marginTop: 14 }}>
          <GradeSummary course={course} target={target} onTargetChange={setTarget} />
        </div>

        <div className="gg-seclabel">
          <h2>Assessments</h2>
          <span>edit weights and marks freely</span>
        </div>

        <GradeTable
          course={course}
          onChange={setCourse}
          editableWeights
          onAddRow={addRow}
        />

        <div className="gg-seclabel">
          <h2>Keep this?</h2>
          <span>{signedIn ? 'save it to your term' : 'sign in to save'}</span>
        </div>

        <div className="gg-panel">
          {saveState === 'saved' ? (
            <>
              <b>Saved to your current term.</b>
              <div style={{ marginTop: 10 }}>
                <Link href="/dashboard" className="gg-termsel" style={{ textDecoration: 'none' }}>
                  Open My Term
                </Link>
              </div>
            </>
          ) : signedIn ? (
            <>
              <button
                type="button"
                className="gg-termsel"
                onClick={saveToTerm}
                disabled={saveState === 'saving'}
              >
                {saveState === 'saving' ? 'Saving…' : 'Save to my term'}
              </button>
              <div className="gg-hint">Carries your weights and any marks you entered.</div>
              {saveError && <div className="gg-err">{saveError}</div>}
            </>
          ) : (
            <>
              <b>Sign in to keep this</b>
              <div className="gg-hint">
                With an account, GooseGrade pre-loads weights from the official outline, tracks
                every course at once, and keeps your record across terms.
              </div>
              <Link
                href="/auth"
                className="gg-termsel"
                style={{ marginTop: 10, display: 'inline-block', textDecoration: 'none' }}
              >
                Create an account
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
